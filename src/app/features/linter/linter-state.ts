import { Service, computed, inject } from '@angular/core';
import { MatChipSelectionChange } from '@angular/material/chips';
import {
  LintDiagnostic,
  LintRuleId,
  lintBook,
  lintDiagnosticSignature,
} from '../../core/services/linter';
import type { LintPrefs } from '../../core/models/project.model';
import { WorkspaceService } from '../../core/services/workspace.service';

/**
 * One shared reactive source for the lorebook health linter (plan 03 §3.3,
 * §3.6.5.4). Since plan 18 (D3/D4) the topbar badge runs its own graph-free
 * pass (`entryDiagnostics`): the entry-scoped rules plus the cheap
 * duplicate-key buckets, with the O(V²) recursion graph excluded through
 * `lintBook`'s `includeGraphRules: false`. The badge stays cheap per
 * keystroke, and Angular computeds are lazy, so the graph work only happens
 * while the pane needs it.
 *
 * Since plan 19 (D3) the pane's two full passes collapsed into ONE shared
 * pass: `unfilteredDiagnostics` runs `lintBook` once over the active book,
 * and `diagnostics` (the pane's filtered list) plus `unfilteredRules` (the
 * mute-chip membership) derive from it by pure post-filtering —
 * byte-identical to the old prefs-shaped calls, because muting/ignoring are
 * emission-level skips and post-filtering a deterministically sorted list
 * preserves the survivors' order (the sort is a total order: severity →
 * firstIndex → unique seq). A muted graph rule no longer short-circuits the
 * shared pass, but plan 19 D2 memoizes the graph's pair verdicts and target
 * key plans by entry identity, so repeat passes over an unchanged book are
 * near-free of real match work — the dominant case (pane open repeatedly).
 *
 * Recompute cadence matches the `TokenMeter` precedent — a full-book pure
 * pass per project signal mutation; `lintBook` is deterministic and
 * read-only, so it is `computed()`-safe.
 *
 * The author's ignore/mute preferences (plan 03 §3.6.5) live on
 * `project.lintPrefs` and are written through
 * `WorkspaceService.updateLintPrefs` — the one prefs path, riding the same
 * mutation chokepoint (`mutateProject`) that persists to IndexedDB
 * automatically. Policy: once prefs exist the field is always written as a
 * complete `LintPrefs` object — empty sides stay as empty arrays rather than
 * dropping the field — so the written shape is stable; `sanitizeLintPrefs`
 * treats absent and empty identically on load.
 */
@Service()
export class LinterState {
  private readonly workspace = inject(WorkspaceService);

  /**
   * The one shared full lint pass over the open project's book (plan 19 D3)
   * — `lintBook` with NO prefs applied, recursion-graph rules included.
   * Every prefs-sensitive view below derives from this single computed;
   * empty without an open project.
   */
  readonly unfilteredDiagnostics = computed<readonly LintDiagnostic[]>(() => {
    const project = this.workspace.activeProject();
    if (!project) {
      return [];
    }
    return lintBook(project.activeBook);
  });

  /**
   * The pane's filtered list — the shared pass post-filtered by the author's
   * prefs (plan 19 D3): muted rules and ignored signatures drop here instead
   * of at emission. Byte-identical to the old prefs-shaped `lintBook` call
   * (see the class doc); empty without an open project.
   */
  readonly diagnostics = computed<readonly LintDiagnostic[]>(() => {
    const project = this.workspace.activeProject();
    if (!project) {
      return [];
    }
    const prefs = project.lintPrefs;
    const muted = new Set(prefs?.mutedRules ?? []);
    const ignored = new Set(prefs?.ignoredSignatures ?? []);
    return this.unfilteredDiagnostics().filter(
      (diagnostic) =>
        !muted.has(diagnostic.rule) && !ignored.has(lintDiagnosticSignature(diagnostic)),
    );
  });

  /**
   * The badge's graph-free lint pass — same prefs shape as `diagnostics` plus
   * `includeGraphRules: false` (plan 18 D4): entry-scoped rules and the
   * cheap duplicate-key buckets, without the O(V²) recursion graph. The
   * approved badge-semantics change (2026-09-27): recursion-cycle and
   * self-trigger findings no longer count live; they appear when the health
   * pane opens (`diagnostics`).
   */
  readonly entryDiagnostics = computed<readonly LintDiagnostic[]>(() => {
    const project = this.workspace.activeProject();
    if (!project) {
      return [];
    }
    const prefs = project.lintPrefs;
    return lintBook(project.activeBook, {
      ignored: new Set(prefs?.ignoredSignatures ?? []),
      mutedRules: new Set(prefs?.mutedRules ?? []),
      includeGraphRules: false,
    });
  });

  /**
   * errors + warnings — drives the badge; info never counts. Read from the
   * graph-free `entryDiagnostics` pass, so muted and ignored issues never
   * light it, and recursion-graph findings no longer count live either (see
   * `entryDiagnostics`).
   */
  readonly issueCount = computed(
    () => this.entryDiagnostics().filter((diagnostic) => diagnostic.severity !== 'info').length,
  );

  /** The rules the author muted, as a set for O(1) chip-state lookups. */
  readonly mutedRules = computed<ReadonlySet<LintRuleId>>(() => {
    return new Set(this.workspace.activeProject()?.lintPrefs?.mutedRules ?? []);
  });

  /** How many diagnostics the author marked "not an issue" — the footer's count. */
  readonly ignoredCount = computed(
    () => this.workspace.activeProject()?.lintPrefs?.ignoredSignatures.length ?? 0,
  );

  /**
   * Rule ids present in the shared unfiltered pass (§3.6.5.3, plan 19 D3) —
   * the mute-chip row's membership source, so muted rules stay visible as
   * muted chips and can be re-enabled. Read only while the pane is open (the
   * badge never reads it); derives from `unfilteredDiagnostics` — no second
   * pass.
   */
  readonly unfilteredRules = computed<ReadonlySet<LintRuleId>>(() => {
    return new Set(this.unfilteredDiagnostics().map((diagnostic) => diagnostic.rule));
  });

  /**
   * Marks one diagnostic "not an issue" (§3.6.5.3): appends its
   * `lintDiagnosticSignature` to `ignoredSignatures`. Idempotent — a
   * double-fire before the row unrenders must not duplicate the signature in
   * the archive, and a no-op leaves the project reference (and the debounced
   * save) untouched.
   */
  ignoreDiagnostic(diagnostic: LintDiagnostic): void {
    const signature = lintDiagnosticSignature(diagnostic);
    this.updatePrefs((prefs) => {
      const ignored = prefs?.ignoredSignatures ?? [];
      if (ignored.includes(signature)) {
        return undefined; // already ignored — no write
      }
      return { ignoredSignatures: [...ignored, signature], mutedRules: prefs?.mutedRules ?? [] };
    });
  }

  /** The pane footer's "Undo all": clears every ignored signature; mutes are untouched. */
  undoAllIgnored(): void {
    this.updatePrefs((prefs) =>
      (prefs?.ignoredSignatures ?? []).length === 0
        ? undefined
        : { ignoredSignatures: [], mutedRules: prefs?.mutedRules ?? [] },
    );
  }

  /** Re-enables every muted rule at once; ignored signatures are untouched. */
  unmuteAll(): void {
    this.updatePrefs((prefs) =>
      (prefs?.mutedRules ?? []).length === 0
        ? undefined
        : { ignoredSignatures: prefs?.ignoredSignatures ?? [], mutedRules: [] },
    );
  }

  /**
   * Chip-driven mute switch (§3.6.5.3, the entry editor's filter-chip
   * contract): selected = the check runs, deselected = muted. Guarded on
   * `isUserInput` exactly like the editor's `EntryUpdatesService.setChipFlag`,
   * so the programmatic `[selected]` re-sync after a prefs write — which
   * emits `selectionChange` with `isUserInput: false` — can never clobber
   * the stored sets.
   */
  setRuleMuted(ruleId: LintRuleId, change: MatChipSelectionChange): void {
    if (!change.isUserInput) {
      return;
    }
    this.updatePrefs((prefs) => {
      const muted = prefs?.mutedRules ?? [];
      if (change.selected === !muted.includes(ruleId)) {
        return undefined; // already in the requested state — no write
      }
      return {
        ignoredSignatures: prefs?.ignoredSignatures ?? [],
        mutedRules: change.selected ? muted.filter((rule) => rule !== ruleId) : [...muted, ruleId],
      };
    });
  }

  /**
   * Writes prefs through the workspace's single lint-preferences path
   * (`WorkspaceService.updateLintPrefs`, which persists via the same
   * `mutateProject` chokepoint as every other mutation). The mutator returns
   * `undefined` to mean "no change", which skips the write entirely — the
   * project reference and its debounced IndexedDB save stay untouched.
   */
  private updatePrefs(mutate: (prefs: LintPrefs | undefined) => LintPrefs | undefined): void {
    const project = this.workspace.activeProject();
    if (!project) {
      return;
    }
    const prefs = mutate(project.lintPrefs);
    if (prefs !== undefined) {
      this.workspace.updateLintPrefs(prefs);
    }
  }
}
