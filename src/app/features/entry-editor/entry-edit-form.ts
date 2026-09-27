import {
  DestroyRef,
  Signal,
  WritableSignal,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { CharacterBookEntry } from '../../core/models/lorebook.model';
import { WorkspaceService } from '../../core/services/workspace.service';
import { EDIT_COMMIT_DEBOUNCE_MS } from './entry-editor.constants';

/** Structural (JSON) equality — form slices are small, flat and key-stable. */
function jsonEqual<M>(a: M, b: M): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ---------------------------------------------------------------------------
// Coercion helpers for `extensions` values, which are untyped by spec
// (`Record<string, unknown>`): forms need concrete, null-free field types.
// ---------------------------------------------------------------------------

/** Reads a finite number, falling back when absent or corrupt. */
export function extNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Reads an optional finite number; anything else counts as "not set". */
export function extNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Reads a string extension; non-string values count as empty. */
export function extText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** How a form section projects one workspace entry into its form model. */
export interface EntrySliceOptions<M> {
  /** The workspace-owned entry under edit (a component input signal). */
  source: Signal<CharacterBookEntry | undefined>;
  /** Slice shown before the entry input is bound; never displayed. */
  fallback: M;
  /** Derives the editable slice from an entry (inverse of `toPatch`). */
  pick: (entry: CharacterBookEntry) => M;
  /** Translates a slice edit into an entry patch. */
  toPatch: (entry: CharacterBookEntry, slice: M) => Partial<CharacterBookEntry>;
}

/**
 * A form-model signal mirrored from the workspace-owned entry, so Signal
 * Forms can edit the single source of truth instead of a detached copy:
 *
 * - **workspace → form:** whenever the entry object is replaced (any editor,
 *   batch dialog, external patch), the slice is re-derived from it. The
 *   `equal` fn drops no-op re-seeds so they never echo back. While a draft
 *   is pending, the replacement merges instead (the merge rule below).
 * - **form → workspace (idle-commit, plan 18 D1):** every real slice edit
 *   arms a trailing `EDIT_COMMIT_DEBOUNCE_MS` debounce — continuous typing
 *   commits once, 300 ms after the last keystroke, so a keystroke costs one
 *   form write + one textarea render, O(1) in book size. A pending draft
 *   flushes on timer elapse, `DestroyRef` teardown (tab close, pane switch),
 *   or external entry replacement. Edits that round-trip through `pick`
 *   unchanged never arm the timer.
 * - **external replacement while a draft is pending (merge rule):** the
 *   mirror tracks the last-seen entry reference. If the replacement carries
 *   a different id the draft is dropped; if the externally-changed fields
 *   (own keys of both objects whose values differ — shallow compare,
 *   `extensions` by reference, deliberately conservative) stay outside the
 *   slice's `toPatch` keys (e.g. an `enabled` toggle while a content draft
 *   pends), the draft is re-applied onto the incoming entry; if they overlap
 *   the slice (e.g. a delimiter re-wrap applied while typing), external
 *   wins — the newer explicit user action is not clobbered by a stale
 *   ≤300 ms draft, the model re-seeds and the draft is dropped.
 *
 * Echo suppression is split by path: the async timer commit self-identifies
 * through pick-equality (below); `echoing` flags only the synchronous
 * in-effect write of the merge rule's re-apply.
 *
 * Known narrow race, accepted (plan §3 D1): a timer-path flush immediately
 * followed by an external same-field write in the same change-detection
 * cycle could swallow the reseed — two user actions cannot land in one tick.
 *
 * Create in an injection context (field initializer is fine); pass the result
 * to `form()` and bind inputs with `[formField]`.
 */
export function entrySliceSignal<M>(options: EntrySliceOptions<M>): WritableSignal<M> {
  const workspace = inject(WorkspaceService);
  const destroyRef = inject(DestroyRef);
  const model = signal<M>(options.fallback, { equal: jsonEqual });

  // Seed state: `seeded` gates the write path until the first real entry is
  // projected (the form starts on `fallback`, which must never be persisted);
  // `echoing` swallows the one workspace change caused by the merge rule's
  // synchronous re-apply write.
  let seeded = false;
  let echoing = false;

  // Pending-draft state (idle-commit): no timer armed ⇔ nothing pending.
  // `armedId` is the entry id the draft was armed against — the merge rule
  // compares an incoming entry's id against it.
  let pendingTimer: ReturnType<typeof setTimeout> | undefined;
  let armedId: number | undefined;
  // The last-seen entry reference, updated on EVERY reseed-effect run
  // (including echo-swallowed and entry-less runs) before any early return —
  // the baseline for the merge rule's external-change detection.
  let lastSeen: CharacterBookEntry | undefined;

  const dropDraft = (): void => {
    if (pendingTimer !== undefined) {
      clearTimeout(pendingTimer);
      pendingTimer = undefined;
    }
    armedId = undefined;
  };

  /**
   * Commits the pending draft now (timer elapse or teardown). Trailing
   * semantics: every model change re-ran the write effect and re-armed the
   * timer, so the model always holds the newest edit. The entry is re-read
   * through `untracked` so a draft armed against an older reference still
   * writes against the current one.
   */
  const commitDraft = (): void => {
    pendingTimer = undefined;
    const entry = untracked(options.source);
    const entryId = entry?.id;
    // The entry vanished (tab closed, project swapped): nothing to write to.
    if (entry === undefined || entryId === undefined) {
      return;
    }
    const slice = untracked(model);
    // An external change may already have produced exactly the drafted value
    // (e.g. a delimiter apply that wrote the drafted content): drop instead
    // of re-writing a no-op patch.
    if (jsonEqual(options.pick(entry), slice)) {
      return;
    }
    // Echo suppression on this async path is pick-equality, NOT `echoing`:
    // after this write lands, the reseed effect sees `pick(newEntry)`. For a
    // round-trip slice the signal's `equal` fn drops the `model.set` — the
    // write effect never re-runs; for a non-round-trip slice (normalized
    // text) the set lands but the write effect's no-op guard below then
    // holds. No echo loop either way.
    workspace.updateEntry(entryId, options.toPatch(entry, slice));
  };

  effect(() => {
    const entry = options.source();
    // lastSeen bookkeeping happens before any early return so the merge rule
    // always compares against the reference the previous run actually saw.
    const previous = lastSeen;
    lastSeen = entry;
    if (!entry) {
      return;
    }
    if (echoing) {
      echoing = false;
      return;
    }
    seeded = true;

    if (pendingTimer !== undefined && previous !== undefined && previous !== entry) {
      if (entry.id === undefined || entry.id !== armedId) {
        // The draft's target entry is gone (different id): drop the draft
        // and fall through to the plain reseed from the incoming entry.
        dropDraft();
      } else {
        // Externally-changed fields: own keys of both objects whose values
        // differ. Shallow per-key compare; nested objects like `extensions`
        // compare by reference — deliberate and conservative (a re-used
        // reference is "unchanged", a cloned one is "changed").
        const externallyChanged = new Set<string>();
        for (const key of new Set([...Object.keys(previous), ...Object.keys(entry)])) {
          const before = (previous as unknown as Record<string, unknown>)[key];
          if (before !== (entry as unknown as Record<string, unknown>)[key]) {
            externallyChanged.add(key);
          }
        }
        const patch = untracked(() => options.toPatch(entry, model()));
        if (Object.keys(patch).some((key) => externallyChanged.has(key))) {
          // External patch overlaps the slice: external wins. The stale draft
          // is dropped (timer with it) and the model re-seeds from the
          // incoming entry — the `equal` fn drops a no-op set.
          dropDraft();
          untracked(() => model.set(options.pick(entry)));
        } else {
          // External patch outside the slice (e.g. an `enabled` toggle while
          // a content draft pends): re-apply the draft so it survives. The
          // re-apply is itself a flush — the pending timer is dropped with
          // it, or a later elapse would only re-write the just-committed
          // draft. Our own follow-up emission is swallowed by `echoing`, and
          // `lastSeen` becomes the post-write entry on that swallowed run.
          echoing = true;
          dropDraft();
          workspace.updateEntry(entry.id, patch);
        }
        return;
      }
    }

    // A same-reference re-run cannot occur (the input signal's equality
    // suppresses it), so this plain reseed either follows a dropped draft or
    // no draft at all — it never clobbers a pending one.
    untracked(() => model.set(options.pick(entry)));
  });

  effect(() => {
    if (!seeded) {
      return;
    }
    const slice = model();
    const entry = untracked(options.source);
    const entryId = entry?.id;
    if (entry === undefined || entryId === undefined) {
      return;
    }
    // No-op guard BEFORE arming: an edit that round-trips through `pick` to
    // the same slice never arms the timer — no workspace write, no churn.
    if (jsonEqual(options.pick(entry), slice)) {
      return;
    }
    // Trailing idle-commit: every real (non-no-op) slice edit clears and
    // re-arms, so continuous typing commits once, 300 ms after the last
    // keystroke (plan 18 D1).
    if (pendingTimer !== undefined) {
      clearTimeout(pendingTimer);
    }
    armedId = entryId;
    pendingTimer = setTimeout(commitDraft, EDIT_COMMIT_DEBOUNCE_MS);
  });

  // Teardown (tab close, pane switch) flushes the pending draft
  // synchronously, then drops the timer — user text in flight must not be
  // lost the way `debouncedSignal`'s cancel-on-destroy drops its value.
  destroyRef.onDestroy(() => {
    if (pendingTimer !== undefined) {
      const timer = pendingTimer;
      commitDraft();
      clearTimeout(timer);
    }
  });

  return model;
}
