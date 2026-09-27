import { Service, InjectionToken, computed, inject, signal } from '@angular/core';
import { MatChipSelectionChange } from '@angular/material/chips';
import type { CharacterBook } from '../../core/models/lorebook.model';
import type { LintPrefs } from '../../core/models/project.model';
import {
  LintDiagnostic,
  LintPhase,
  LintProgress,
  LintRuleId,
  createLintPass,
  lintBook,
  lintDiagnosticSignature,
} from '../../core/services/linter';
import { WorkspaceService } from '../../core/services/workspace.service';

/**
 * The scheduler the pane's health-run driver awaits between chunks (plan 19
 * D4) — a `setTimeout(0)` macrotask yield so the main thread can paint
 * between the engine's chunk boundaries. Spec seam: unit tests override this
 * provider (`TestBed.overrideProvider`) with an immediate or gate-stepped
 * scheduler to drive runs deterministically.
 */
export const HEALTH_RUN_YIELD = new InjectionToken<() => Promise<void>>('HEALTH_RUN_YIELD', {
  providedIn: 'root',
  factory: () => defaultHealthRunYield,
});

const defaultHealthRunYield = (): Promise<void> =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

/**
 * The health pane's async run state (plan 19 D4). The pane renders ONLY from
 * this signal — never from a synchronous lint pass — so opening it never
 * blocks on the O(V²) evaluation:
 *
 * - `idle` — no run in flight (pane never opened, or closed again).
 * - `running` — a chunked pass is stepping; `percent` is the determinate
 *   bar's value (see `progressPercent` for the phase weighting).
 * - `done` — the pass delivered: `diagnostics` is the prefs-filtered list
 *   the pane's sections and summary render from, `unfilteredRules` the
 *   mute-chip row's membership. Both derive from the one unfiltered pass by
 *   post-filtering — plan 19 D3's byte-identical-derivation contract (the
 *   filter and the deterministic sort order are the sync path's own).
 */
export type HealthRun =
  | { readonly kind: 'idle' }
  | { readonly kind: 'running'; readonly percent: number }
  | {
      readonly kind: 'done';
      readonly diagnostics: readonly LintDiagnostic[];
      readonly unfilteredRules: ReadonlySet<LintRuleId>;
    };

/** The `done` variant of `HealthRun` — what the pane's results view reads. */
export type DoneHealthRun = Extract<HealthRun, { kind: 'done' }>;

/**
 * Opaque per-pane run session: `LinterDialog` passes itself to
 * `startHealthRun`/`stopHealthRun`, so closing one stacked pane can never
 * stop the run a newer pane started — only the active session's stop lands.
 */
export type HealthRunSession = object;

/** Delivered results for a book-less workspace — the pane's empty state. */
const EMPTY_DONE_RUN: DoneHealthRun = {
  kind: 'done',
  diagnostics: [],
  unfilteredRules: new Set<LintRuleId>(),
};

/**
 * Fixed phase weights of the pane's progress bar (plan 19 D4). The mapping is
 * simple, monotonic and honest about wall time: on the probe books the
 * recursion graph dominates (§2 measured 2.2–5.4 s, nearly all of it the
 * O(V²) pair loop), so it owns ~90% of the bar while the two cheap phases
 * share the first 10%. Within a phase the bar interpolates linearly over the
 * engine's `done`/`total`; the disjoint ascending intervals keep the mapping
 * monotonic by construction (phases run in emission order).
 */
const PHASE_WEIGHTS: Record<LintPhase, { readonly start: number; readonly weight: number }> = {
  'entry-rules': { start: 0, weight: 5 },
  'duplicate-keys': { start: 5, weight: 5 },
  'recursion-graph': { start: 10, weight: 90 },
};

/** Maps the engine's chunk progress onto the bar's 0–100%. */
function progressPercent(progress: LintProgress): number {
  const { start, weight } = PHASE_WEIGHTS[progress.phase];
  const fraction = progress.total > 0 ? Math.min(progress.done / progress.total, 1) : 1;
  return Math.min(100, Math.round(start + fraction * weight));
}

/**
 * One shared reactive source for the lorebook health linter (plan 03 §3.3,
 * §3.6.5.4). Since plan 19 (D4) the health pane renders from an ASYNC RUN
 * (`healthRun`) instead of a synchronous pass: opening the pane starts a
 * chunked run of the resumable engine (`createLintPass`, plan 19 D1), the
 * driver yields to the scheduler between chunks so the pane paints and the
 * progress bar genuinely animates, and the delivered results replace the
 * loading state. The run restarts on every project mutation while the pane
 * is open (the pane's live-recompute contract — the dialog's restart effect
 * calls `startHealthRun` again) and stops when the pane closes
 * (`stopHealthRun`), so no driver burns CPU behind a closed pane. A newer
 * run supersedes an older one between steps (run token + project identity
 * checks before every step), so a stale run can never overwrite newer
 * results.
 *
 * The topbar badge keeps its graph-free SYNC path (plan 18 D4,
 * `entryDiagnostics` → `issueCount`): cheap per keystroke, untouched by the
 * run. The author's ignore/mute preferences (plan 03 §3.6.5) live on
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
  private readonly yieldBetween = inject(HEALTH_RUN_YIELD);

  /**
   * The health pane's async run (plan 19 D4) — the pane's single render
   * source. See the `HealthRun` type for the state contract and the class
   * doc for the lifecycle.
   */
  readonly healthRun = signal<HealthRun>({ kind: 'idle' });

  /**
   * Generation counter of the run lifecycle: every start/stop bumps it, and
   * the in-flight driver checks it before each step — a bump between steps
   * abandons the stale driver before it can burn another chunk of CPU.
   */
  private runToken = 0;

  /** The session that owns the current run; only its stop lands. */
  private activeSession: HealthRunSession | null = null;

  /**
   * The badge's graph-free lint pass — same prefs shape as the pane's
   * delivered list plus `includeGraphRules: false` (plan 18 D4): entry-scoped
   * rules and the cheap duplicate-key buckets, without the O(V²) recursion
   * graph. The approved badge-semantics change (2026-09-27): recursion-cycle
   * and self-trigger findings no longer count live; they appear when the
   * health pane delivers (`healthRun`).
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
   * Starts (or restarts) the pane's health run (plan 19 D4). Called by the
   * pane when it opens and re-called by its restart effect on every project
   * mutation while open — each call supersedes any in-flight run (a new
   * engine instance over the current book; the old driver exits between
   * steps). Delivers into `healthRun`. No-op CPU-wise without a project: the
   * pane gets empty results, matching the sync path's old empty state.
   */
  startHealthRun(session: HealthRunSession): void {
    const token = ++this.runToken;
    this.activeSession = session;
    const project = this.workspace.activeProject();
    if (!project) {
      this.healthRun.set(EMPTY_DONE_RUN);
      return;
    }
    this.healthRun.set({ kind: 'running', percent: 0 });
    void this.driveRun(token, project, project.lintPrefs);
  }

  /**
   * Stops the pane's run (plan 19 D4) — the pane closed, so no driver may
   * keep stepping behind it. Only the active session's stop lands: a
   * stacked pane closing must not kill the run a newer pane started.
   * Bumping the token abandons the in-flight driver between steps and resets
   * `healthRun` to idle.
   */
  stopHealthRun(session: HealthRunSession): void {
    if (this.activeSession !== session) {
      return;
    }
    this.activeSession = null;
    this.runToken += 1;
    this.healthRun.set({ kind: 'idle' });
  }

  /**
   * Steps the resumable engine chunk by chunk, yielding to the scheduler
   * between chunks so the main thread can paint. Liveness is checked TWO
   * ways before every step: the run token (a newer start/stop happened) and
   * the project identity (a mutation landed before the pane's restart effect
   * could bump the token — the effect and the driver interleave on
   * independent schedulers). The scheduler yield comes BEFORE the first step
   * too, so an open always paints its loading state before the first chunk
   * of work runs.
   */
  private async driveRun(
    token: number,
    project: { readonly activeBook: CharacterBook },
    prefs: LintPrefs | undefined,
  ): Promise<void> {
    const pass = createLintPass(project.activeBook);
    for (;;) {
      await this.yieldBetween();
      if (token !== this.runToken || this.workspace.activeProject() !== project) {
        return; // superseded by a newer run, or the pane closed
      }
      if (pass.step()) {
        break;
      }
      this.healthRun.set({ kind: 'running', percent: progressPercent(pass.progress()) });
    }
    if (token !== this.runToken || this.workspace.activeProject() !== project) {
      return;
    }
    this.healthRun.set(this.deliver(pass.finish(), prefs));
  }

  /**
   * Derives the delivered results from the finished unfiltered pass (plan 19
   * D3's post-filtering): muted rules and ignored signatures drop from the
   * pane's list, the mute-chip membership keeps every rule the pass found.
   * The run is pinned to its start project (the driver's identity check
   * guarantees the prefs still match the book the pass ran over).
   */
  private deliver(
    unfiltered: readonly LintDiagnostic[],
    prefs: LintPrefs | undefined,
  ): DoneHealthRun {
    const muted = new Set(prefs?.mutedRules ?? []);
    const ignored = new Set(prefs?.ignoredSignatures ?? []);
    return {
      kind: 'done',
      diagnostics: unfiltered.filter(
        (diagnostic) =>
          !muted.has(diagnostic.rule) && !ignored.has(lintDiagnosticSignature(diagnostic)),
      ),
      unfilteredRules: new Set(unfiltered.map((diagnostic) => diagnostic.rule)),
    };
  }

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
