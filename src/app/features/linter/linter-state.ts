import { Service, computed, inject } from '@angular/core';
import { MatChipSelectionChange } from '@angular/material/chips';
import {
  LintDiagnostic,
  LintRuleId,
  lintBook,
  lintDiagnosticSignature,
} from '../../core/services/linter';
import { LintPrefs } from '../../core/models/project.model';
import { WorkspaceService } from '../../core/services/workspace.service';

/**
 * One shared reactive source for the lorebook health linter (plan 03 §3.3,
 * §3.6.5.4): the topbar badge and the health check pane both read the same
 * memoized diagnostic pass, so they can never disagree about the book's
 * health. Root-provided and consumed cross-feature exactly like
 * `ProjectActionsService`.
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
   * Single memoized lint pass shared by the topbar badge and the dialog:
   * `lintBook` with the project's ignored signatures and muted rules applied
   * (§3.6.5.4). Empty without an open project.
   */
  readonly diagnostics = computed<readonly LintDiagnostic[]>(() => {
    const project = this.workspace.activeProject();
    if (!project) {
      return [];
    }
    const prefs = project.lintPrefs;
    return lintBook(project.activeBook, {
      ignored: new Set(prefs?.ignoredSignatures ?? []),
      mutedRules: new Set(prefs?.mutedRules ?? []),
    });
  });

  /** errors + warnings — drives the badge; info never counts. Muted and ignored issues are already absent from `diagnostics`, so they never light the badge either. */
  readonly issueCount = computed(
    () => this.diagnostics().filter((diagnostic) => diagnostic.severity !== 'info').length,
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
   * Rule ids present in an unfiltered pass over the same book (§3.6.5.3) —
   * the mute-chip row's membership source, so muted rules stay visible as
   * muted chips and can be re-enabled. Read only while the pane is open (the
   * badge never reads it), and pure like `diagnostics`.
   */
  readonly unfilteredRules = computed<ReadonlySet<LintRuleId>>(() => {
    const book = this.workspace.activeProject()?.activeBook;
    if (!book) {
      return new Set<LintRuleId>();
    }
    return new Set(lintBook(book).map((diagnostic) => diagnostic.rule));
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
        mutedRules: change.selected
          ? muted.filter((rule) => rule !== ruleId)
          : [...muted, ruleId],
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
