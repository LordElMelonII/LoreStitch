import { Signal, WritableSignal, effect, inject, signal, untracked } from '@angular/core';
import { CharacterBookEntry } from '../../core/models/lorebook.model';
import { WorkspaceService } from '../../core/services/workspace.service';

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
 *   `equal` fn drops no-op re-seeds so they never echo back.
 * - **form → workspace:** every real slice edit is translated into an entry
 *   patch funneled through the `WorkspaceService`, preserving the
 *   immutable-update / dirty-tracking / debounced-save behavior of the
 *   event-driven controls. Writes that don't round-trip through `pick`
 *   verbatim (e.g. the normalized character-filter text) are flagged so their
 *   echo is not mistaken for an external edit.
 *
 * Create in an injection context (field initializer is fine); pass the result
 * to `form()` and bind inputs with `[formField]`.
 */
export function entrySliceSignal<M>(options: EntrySliceOptions<M>): WritableSignal<M> {
  const workspace = inject(WorkspaceService);
  const model = signal<M>(options.fallback, { equal: jsonEqual });

  // Seed state: `seeded` gates the write path until the first real entry is
  // projected (the form starts on `fallback`, which must never be persisted);
  // `echoing` swallows the one workspace change caused by our own write.
  let seeded = false;
  let echoing = false;

  effect(() => {
    const entry = options.source();
    if (!entry) {
      return;
    }
    if (echoing) {
      echoing = false;
      return;
    }
    seeded = true;
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
    if (jsonEqual(options.pick(entry), slice)) {
      return;
    }
    echoing = true;
    untracked(() => workspace.updateEntry(entryId, options.toPatch(entry, slice)));
  });

  return model;
}
