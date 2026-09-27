import { TestBed } from '@angular/core/testing';
import { MatChipSelectionChange } from '@angular/material/chips';
import { CharacterBookEntry } from '../../core/models/lorebook.model';
import { LintPrefs } from '../../core/models/project.model';
import { WorkspaceService } from '../../core/services/workspace.service';
import {
  DoneHealthRun,
  HealthRun,
  HealthRunSession,
  HEALTH_RUN_YIELD,
  LinterState,
} from './linter-state';
import { entryWith as entry, projectOf, severityFixture } from '../../../testing/project-fixtures';

/** A user-initiated chip selection change, as the pane's mute chips emit. */
function chipChange(selected: boolean, isUserInput = true): MatChipSelectionChange {
  return { isUserInput, selected } as MatChipSelectionChange;
}

/** Seeds the linter-state workspace, optionally with project lint prefs. */
function seededProject(entries: CharacterBookEntry[], lintPrefs?: LintPrefs) {
  return projectOf(entries, {
    id: 'linter-state-project',
    title: 'Linter',
    ...(lintPrefs ? { lintPrefs } : {}),
  });
}

describe('LinterState', () => {
  let workspace: WorkspaceService;
  let state: LinterState;

  // --- Health-run scheduler seam (plan 19 D4) --------------------------------

  /**
   * The default spec scheduler: immediate — a run completes within one
   * macrotask flush. The lifecycle tests swap in the gated scheduler, which
   * holds the run at each chunk boundary until released (one pump per chunk),
   * so mid-run states and stale-run supersession are deterministic.
   */
  const immediateYield = async (): Promise<void> => undefined;
  let activeYield: () => Promise<void> = immediateYield;
  const tunableYield = (): Promise<void> => activeYield();

  /** Chunk gates of the gated scheduler, one per awaited chunk boundary. */
  let gates: (() => void)[] = [];

  /** The one pane session most tests run under. */
  const SESSION: HealthRunSession = {};

  async function flushRun(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  /** Advances a gated run by exactly one chunk boundary. */
  async function pumpChunk(): Promise<void> {
    gates.splice(0).forEach((release) => release());
    await flushRun();
  }

  /** Pumps a gated run chunk by chunk until it delivers (bounded). */
  async function pumpToDone(maxChunks = 100): Promise<void> {
    for (let i = 0; i < maxChunks && state.healthRun().kind !== 'done'; i += 1) {
      await pumpChunk();
    }
  }

  function doneRun(): DoneHealthRun {
    const run = state.healthRun();
    assert(run.kind === 'done');
    return run;
  }

  /** Seeds a project, starts the pane's run, and flushes it to delivery. */
  async function runOver(
    entries: CharacterBookEntry[],
    lintPrefs?: LintPrefs,
  ): Promise<DoneHealthRun> {
    workspace.activeProject.set(seededProject(entries, lintPrefs));
    state.startHealthRun(SESSION);
    await flushRun();
    return doneRun();
  }

  beforeEach(async () => {
    TestBed.configureTestingModule({});
    // The run scheduler seam — overridden before any inject instantiates
    // the module (the dialog spec's documented ordering).
    TestBed.overrideProvider(HEALTH_RUN_YIELD, { useValue: tunableYield });
    workspace = TestBed.inject(WorkspaceService);
    state = TestBed.inject(LinterState);
    // Allow the workspace's async init() to settle before assertions.
    await new Promise((resolve) => setTimeout(resolve, 0));
    activeYield = immediateYield;
    gates = [];
  });

  // --- The pane's async run (plan 19 D4) --------------------------------------

  it('delivers empty done results without an open project', async () => {
    state.startHealthRun(SESSION);
    await flushRun();

    expect(state.healthRun()).toEqual({
      kind: 'done',
      diagnostics: [],
      unfilteredRules: new Set(),
    });
  });

  it('starts into running at zero and steps the bar through the phase weights', async () => {
    // Gated: every pump is exactly one engine chunk over the severity
    // fixture (3 entries). The mapping weights entry-rules 0→5,
    // duplicate-keys 5→10 and the recursion graph 10→100 — the graph
    // dominates wall time on large books, so it owns the last 90%.
    gates = [];
    activeYield = () => new Promise<void>((resolve) => gates.push(resolve));
    workspace.activeProject.set(seededProject(severityFixture()));
    state.startHealthRun(SESSION);
    expect(state.healthRun()).toEqual({ kind: 'running', percent: 0 });

    await pumpChunk(); // entry-rules complete (3/3)
    let run: HealthRun = state.healthRun();
    assert(run.kind === 'running');
    expect(run.percent).toBe(5);

    await pumpChunk(); // duplicate-keys complete (1/1)
    run = state.healthRun();
    assert(run.kind === 'running');
    expect(run.percent).toBe(10);

    await pumpChunk(); // graph sources complete (3/4 of the phase)
    run = state.healthRun();
    assert(run.kind === 'running');
    expect(run.percent).toBe(78); // 10 + (3/4)·90 = 77.5

    await pumpChunk(); // the bounded tail delivers — no 100% frame to sit on
    expect(state.healthRun().kind).toBe('done');
  });

  it('delivers the prefs-filtered list and the chip membership from one pass (plan 19 D3)', async () => {
    const run = await runOver(severityFixture());

    expect(run.diagnostics.map((d) => d.rule)).toEqual([
      'invalid-regex',
      'never-activatable',
      'selective-without-secondary',
    ]);
    // The chip membership derives from the same pass — every rule the list
    // carries, plus nothing else when nothing was muted or ignored.
    expect([...run.unfilteredRules].sort()).toEqual(
      [...new Set(run.diagnostics.map((d) => d.rule))].sort(),
    );
  });

  it('delivered list drops a muted graph finding; chip membership keeps it', async () => {
    // A recursion cycle muted by prefs: the old emission-level mute dropped
    // the finding; the run delivers it post-filtered out of the pane's list
    // while the chip row keeps the rule visible so it can be re-enabled.
    const run = await runOver(
      [
        entry(0, { comment: 'Alpha', keys: ['alpha'], content: 'the beta rises' }),
        entry(1, { comment: 'Beta', keys: ['beta'], content: 'the alpha falls' }),
      ],
      { ignoredSignatures: [], mutedRules: ['recursion-cycle'] },
    );

    expect(run.diagnostics).toEqual([]);
    expect(run.unfilteredRules.has('recursion-cycle')).toBe(true);
  });

  it('delivered list drops ignored signatures; the chips keep every pass rule', async () => {
    const run = await runOver(severityFixture(), {
      ignoredSignatures: ['invalid-regex|0|/servant(/'],
      mutedRules: [],
    });

    expect(run.diagnostics.map((d) => d.rule)).toEqual([
      'never-activatable',
      'selective-without-secondary',
    ]);
    expect(run.unfilteredRules.has('invalid-regex')).toBe(true);
  });

  it('delivered chip membership keeps muted rules visible for re-enabling', async () => {
    const run = await runOver(severityFixture(), {
      ignoredSignatures: [],
      mutedRules: ['never-activatable'],
    });

    expect(run.diagnostics.map((d) => d.rule)).toEqual([
      'invalid-regex',
      'selective-without-secondary',
    ]);
    expect(run.unfilteredRules.has('never-activatable')).toBe(true);
  });

  it('applies muted rules and ignored signatures together in the delivered list', async () => {
    // The old sync pane pass filtered both prefs sides in one pass; the run's
    // post-filtering keeps that shape — each side drops its own diagnostics
    // independently, and both rules stay visible on the chip row.
    const run = await runOver(severityFixture(), {
      ignoredSignatures: ['invalid-regex|0|/servant(/'],
      mutedRules: ['never-activatable'],
    });

    expect(run.diagnostics.map((d) => d.rule)).toEqual(['selective-without-secondary']);
    expect(run.unfilteredRules.has('invalid-regex')).toBe(true);
    expect(run.unfilteredRules.has('never-activatable')).toBe(true);
  });

  it('restarts the run over a changed project (the pane live-recompute cadence)', async () => {
    await runOver(severityFixture());
    expect(doneRun().diagnostics).toHaveLength(3);

    workspace.activeProject.set(
      seededProject([entry(0, { comment: 'Clean', keys: ['paris'], content: 'Plain prose.' })]),
    );
    state.startHealthRun(SESSION); // the pane's restart effect on the mutation
    expect(state.healthRun().kind).toBe('running');

    await flushRun();
    expect(doneRun().diagnostics).toEqual([]);
  });

  it('a newer run supersedes an in-flight one — stale late steps never overwrite', async () => {
    // Gated: run A is held mid-flight when the newer run starts.
    gates = [];
    activeYield = () => new Promise<void>((resolve) => gates.push(resolve));
    workspace.activeProject.set(seededProject(severityFixture()));
    state.startHealthRun(SESSION);
    await pumpChunk();

    workspace.activeProject.set(
      seededProject([entry(0, { comment: 'Clean', keys: ['paris'], content: 'Plain prose.' })]),
    );
    state.startHealthRun(SESSION);
    expect(state.healthRun()).toEqual({ kind: 'running', percent: 0 });

    // Drain everything — A's remaining gates and all of B's.
    await pumpToDone();

    // B's delivered results only: A's late steps never surfaced.
    const run = doneRun();
    expect(run.diagnostics).toEqual([]);
    expect(run.unfilteredRules.size).toBe(0);
  });

  it('stop abandons the in-flight driver and resets to idle', async () => {
    gates = [];
    activeYield = () => new Promise<void>((resolve) => gates.push(resolve));
    workspace.activeProject.set(seededProject(severityFixture()));
    state.startHealthRun(SESSION);
    await pumpChunk();
    expect(state.healthRun().kind).toBe('running');

    state.stopHealthRun(SESSION); // the pane closed
    expect(state.healthRun()).toEqual({ kind: 'idle' });

    // The held gate resolves; the abandoned driver exits without stepping or
    // awaiting again — no background CPU behind the closed pane.
    await pumpChunk();
    expect(state.healthRun()).toEqual({ kind: 'idle' });
    expect(gates).toHaveLength(0);

    // Stopping again is safe: the session is no longer active, nothing lands.
    state.stopHealthRun(SESSION);
    expect(state.healthRun()).toEqual({ kind: 'idle' });
  });

  it('a stale session stop does not land — a stacked pane cannot kill the active run', async () => {
    gates = [];
    activeYield = () => new Promise<void>((resolve) => gates.push(resolve));
    const firstPane: HealthRunSession = {};
    const secondPane: HealthRunSession = {};

    workspace.activeProject.set(seededProject(severityFixture()));
    state.startHealthRun(firstPane);
    state.startHealthRun(secondPane); // a second pane opened — its run is active
    await pumpChunk();

    state.stopHealthRun(firstPane); // the first pane closes
    expect(state.healthRun().kind).toBe('running');

    await pumpToDone();
    expect(doneRun().diagnostics).toHaveLength(3); // the active run completed
  });

  // --- The badge's graph-free sync path (plan 18 D4, unchanged) ----------------

  it('reports nothing on the badge path without an open project', () => {
    expect(state.entryDiagnostics()).toEqual([]);
    expect(state.issueCount()).toBe(0);
    expect(state.ignoredCount()).toBe(0);
  });

  it('counts only errors and warnings for the badge — info never lights it', () => {
    workspace.activeProject.set(seededProject(severityFixture()));
    expect(state.issueCount()).toBe(2);

    workspace.activeProject.set(
      seededProject([entry(0, { keys: ['paris'], selective: true, secondary_keys: [] })]),
    );
    expect(state.issueCount()).toBe(0);
  });

  it('badge excludes recursion-graph findings the run still delivers (plan 18 D4)', async () => {
    // A recursion cycle is a warning — under the old shared pass it counted
    // live; the badge now reads the graph-free entryDiagnostics pass.
    workspace.activeProject.set(
      seededProject([
        entry(0, { comment: 'Alpha', keys: ['alpha'], content: 'the beta rises' }),
        entry(1, { comment: 'Beta', keys: ['beta'], content: 'the alpha falls' }),
      ]),
    );
    state.startHealthRun(SESSION);
    await flushRun();

    // The pane's delivered run keeps the graph finding.
    expect(doneRun().diagnostics.map((d) => d.rule)).toContain('recursion-cycle');
    // The badge's graph-free pass does not — nothing else in the book is wrong.
    expect(state.entryDiagnostics()).toEqual([]);
    expect(state.issueCount()).toBe(0);
  });

  it('badge pass applies prefs like the delivered run — muted/ignored never count', () => {
    workspace.activeProject.set(
      seededProject(severityFixture(), {
        ignoredSignatures: ['invalid-regex|0|/servant(/'],
        mutedRules: ['never-activatable'],
      }),
    );

    expect(state.entryDiagnostics().map((d) => d.rule)).toEqual(['selective-without-secondary']);
    expect(state.issueCount()).toBe(0);
  });

  // --- Preferences mutators (the one prefs path, unchanged) --------------------

  it('ignoreDiagnostic appends the signature through the workspace and drops the row', async () => {
    await runOver(severityFixture());
    const target = doneRun().diagnostics[0];
    assert(target);

    state.ignoreDiagnostic(target);

    expect(workspace.activeProject()?.lintPrefs).toEqual({
      ignoredSignatures: ['invalid-regex|0|/servant(/'],
      mutedRules: [],
    });
    expect(state.ignoredCount()).toBe(1);
    // A fresh run delivers the row gone.
    state.startHealthRun(SESSION);
    await flushRun();
    expect(doneRun().diagnostics.map((d) => d.rule)).not.toContain('invalid-regex');
  });

  it('ignoreDiagnostic is idempotent and writes nothing when already ignored', async () => {
    await runOver(severityFixture());
    const target = doneRun().diagnostics[0];
    assert(target);
    state.ignoreDiagnostic(target);
    const projectAfterFirst = workspace.activeProject();

    state.ignoreDiagnostic(target);

    expect(workspace.activeProject()).toBe(projectAfterFirst);
    expect(workspace.activeProject()?.lintPrefs?.ignoredSignatures).toHaveLength(1);
  });

  it('undoAllIgnored clears ignored signatures and keeps mutes', async () => {
    await runOver(severityFixture());
    const target = doneRun().diagnostics[0];
    assert(target);
    state.ignoreDiagnostic(target);
    state.setRuleMuted('recursion-cycle', chipChange(false));

    state.undoAllIgnored();

    expect(workspace.activeProject()?.lintPrefs).toEqual({
      ignoredSignatures: [],
      mutedRules: ['recursion-cycle'],
    });
    expect(state.ignoredCount()).toBe(0);
  });

  it('unmuteAll clears muted rules and keeps ignored signatures', () => {
    workspace.activeProject.set(
      seededProject(severityFixture(), {
        ignoredSignatures: ['invalid-regex|0|/servant(/'],
        mutedRules: ['recursion-cycle', 'self-trigger'],
      }),
    );

    state.unmuteAll();

    expect(workspace.activeProject()?.lintPrefs).toEqual({
      ignoredSignatures: ['invalid-regex|0|/servant(/'],
      mutedRules: [],
    });
  });

  it('setRuleMuted maps a user chip selection onto mutedRules', async () => {
    await runOver(severityFixture());

    // Deselected chip = muted.
    state.setRuleMuted('never-activatable', chipChange(false));
    expect(workspace.activeProject()?.lintPrefs?.mutedRules).toEqual(['never-activatable']);
    expect(state.mutedRules().has('never-activatable')).toBe(true);
    // A fresh run delivers the muted rule out of the pane's list.
    state.startHealthRun(SESSION);
    await flushRun();
    expect(doneRun().diagnostics.map((d) => d.rule)).not.toContain('never-activatable');

    // Re-selected chip = the check runs again.
    state.setRuleMuted('never-activatable', chipChange(true));
    // Empty sides stay as empty arrays: the prefs shape is stable once created.
    expect(workspace.activeProject()?.lintPrefs).toEqual({
      ignoredSignatures: [],
      mutedRules: [],
    });
    state.startHealthRun(SESSION);
    await flushRun();
    expect(doneRun().diagnostics.map((d) => d.rule)).toContain('never-activatable');
  });

  it('setRuleMuted writes nothing when the chip state already matches or is not user input', () => {
    workspace.activeProject.set(seededProject(severityFixture()));
    state.setRuleMuted('never-activatable', chipChange(false));
    const projectAfterMute = workspace.activeProject();

    // Requesting the already-stored state is a no-op: no write.
    state.setRuleMuted('never-activatable', chipChange(false));
    expect(workspace.activeProject()).toBe(projectAfterMute);

    // The programmatic `[selected]` re-sync (isUserInput false) never writes —
    // the entry editor's `setChipFlag` guard.
    state.setRuleMuted('never-activatable', chipChange(true, false));
    expect(workspace.activeProject()?.lintPrefs?.mutedRules).toEqual(['never-activatable']);
  });

  it('leaves the workspace untouched when mutators fire without a project', () => {
    state.ignoreDiagnostic({
      rule: 'invalid-regex',
      severity: 'error',
      entryIds: [0],
      message: 'x',
    });
    state.undoAllIgnored();
    state.unmuteAll();
    state.setRuleMuted('recursion-cycle', chipChange(false));

    expect(workspace.activeProject()).toBeNull();
  });
});
