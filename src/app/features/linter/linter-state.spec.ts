import { TestBed } from '@angular/core/testing';
import { MatChipSelectionChange } from '@angular/material/chips';
import { CharacterBookEntry } from '../../core/models/lorebook.model';
import { LintPrefs } from '../../core/models/project.model';
import { WorkspaceService } from '../../core/services/workspace.service';
import { LinterState } from './linter-state';
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

  beforeEach(async () => {
    TestBed.configureTestingModule({});
    workspace = TestBed.inject(WorkspaceService);
    state = TestBed.inject(LinterState);
    // Allow the workspace's async init() to settle before assertions.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('reports no diagnostics without an open project', () => {
    expect(state.diagnostics()).toEqual([]);
    expect(state.unfilteredDiagnostics()).toEqual([]);
    expect(state.issueCount()).toBe(0);
    expect(state.unfilteredRules().size).toBe(0);
    expect(state.ignoredCount()).toBe(0);
  });

  it('lints the active book once and memoizes across reads', () => {
    workspace.activeProject.set(seededProject(severityFixture()));

    const diagnostics = state.diagnostics();
    expect(state.diagnostics()).toBe(diagnostics); // same reference: memoized
    expect(diagnostics.map((d) => d.rule)).toEqual([
      'invalid-regex',
      'never-activatable',
      'selective-without-secondary',
    ]);
  });

  it('counts only errors and warnings for the badge — info never lights it', () => {
    workspace.activeProject.set(seededProject(severityFixture()));
    expect(state.issueCount()).toBe(2);

    workspace.activeProject.set(
      seededProject([entry(0, { keys: ['paris'], selective: true, secondary_keys: [] })]),
    );
    expect(state.issueCount()).toBe(0);
  });

  it('badge excludes recursion-graph findings the full pass still reports (plan 18 D4)', () => {
    // A recursion cycle is a warning — under the old shared pass it counted
    // live; the badge now reads the graph-free entryDiagnostics pass.
    workspace.activeProject.set(
      seededProject([
        entry(0, { comment: 'Alpha', keys: ['alpha'], content: 'the beta rises' }),
        entry(1, { comment: 'Beta', keys: ['beta'], content: 'the alpha falls' }),
      ]),
    );

    // The pane's full pass keeps the graph finding.
    expect(state.diagnostics().map((d) => d.rule)).toContain('recursion-cycle');
    // The badge's graph-free pass does not — nothing else in the book is wrong.
    expect(state.entryDiagnostics()).toEqual([]);
    expect(state.issueCount()).toBe(0);
  });

  it('badge pass applies prefs like the full pass — muted/ignored never count', () => {
    workspace.activeProject.set(
      seededProject(severityFixture(), {
        ignoredSignatures: ['invalid-regex|0|/servant(/'],
        mutedRules: ['never-activatable'],
      }),
    );

    expect(state.entryDiagnostics().map((d) => d.rule)).toEqual(['selective-without-secondary']);
    expect(state.issueCount()).toBe(0);
  });

  it('recomputes when the project signal changes', () => {
    workspace.activeProject.set(seededProject(severityFixture()));
    const before = state.diagnostics().length;

    workspace.activeProject.set(
      seededProject([
        entry(0, { comment: 'Clean', keys: ['paris'], content: 'Something else entirely.' }),
      ]),
    );
    expect(state.diagnostics().length).toBe(0);
    expect(before).toBe(3);
  });

  it('applies the project prefs: muted rules and ignored signatures never surface', () => {
    workspace.activeProject.set(
      seededProject(severityFixture(), {
        ignoredSignatures: ['invalid-regex|0|/servant(/'],
        mutedRules: ['never-activatable'],
      }),
    );

    expect(state.diagnostics().map((d) => d.rule)).toEqual(['selective-without-secondary']);
    // The badge follows the filtered result: muted/ignored issues never count.
    expect(state.issueCount()).toBe(0);
  });

  it('exposes the one shared unfiltered pass the filtered views derive from (plan 19 D3)', () => {
    workspace.activeProject.set(seededProject(severityFixture()));

    expect(state.unfilteredDiagnostics().map((d) => d.rule)).toEqual([
      'invalid-regex',
      'never-activatable',
      'selective-without-secondary',
    ]);
    // `unfilteredRules` derives from the same pass — no second lintBook run.
    expect([...state.unfilteredRules()].sort()).toEqual(
      [...new Set(state.unfilteredDiagnostics().map((d) => d.rule))].sort(),
    );
  });

  it('diagnostics excludes a muted graph finding the shared pass still reports (plan 19 D3)', () => {
    // A recursion cycle muted by prefs: the old emission-level mute dropped
    // the finding; the shared pass emits it and `diagnostics` post-filters.
    workspace.activeProject.set(
      seededProject(
        [
          entry(0, { comment: 'Alpha', keys: ['alpha'], content: 'the beta rises' }),
          entry(1, { comment: 'Beta', keys: ['beta'], content: 'the alpha falls' }),
        ],
        { ignoredSignatures: [], mutedRules: ['recursion-cycle'] },
      ),
    );

    // The shared pass keeps the graph finding; the pane's filtered list drops
    // it; the chip row keeps the rule visible so it can be re-enabled.
    expect(state.unfilteredDiagnostics().map((d) => d.rule)).toContain('recursion-cycle');
    expect(state.diagnostics()).toEqual([]);
    expect(state.unfilteredRules().has('recursion-cycle')).toBe(true);
    // Badge semantics unchanged (task 18): graph-free pass, nothing counts.
    expect(state.entryDiagnostics()).toEqual([]);
    expect(state.issueCount()).toBe(0);
  });

  it('diagnostics drops ignored signatures from the shared pass, near-misses stay (plan 19 D3)', () => {
    workspace.activeProject.set(
      seededProject(severityFixture(), {
        ignoredSignatures: ['invalid-regex|0|/servant(/'],
        mutedRules: [],
      }),
    );

    expect(state.unfilteredDiagnostics().map((d) => d.rule)).toContain('invalid-regex');
    expect(state.diagnostics().map((d) => d.rule)).toEqual([
      'never-activatable',
      'selective-without-secondary',
    ]);
  });

  it('exposes the rules present in an unfiltered pass for the mute-chip row', () => {
    workspace.activeProject.set(seededProject(severityFixture()));

    const rules = state.unfilteredRules();
    expect(rules.has('invalid-regex')).toBe(true);
    expect(rules.has('never-activatable')).toBe(true);
    expect(rules.has('selective-without-secondary')).toBe(true);
    // Muted rules stay in the unfiltered set so their chips remain visible.
    workspace.activeProject.set(
      seededProject(severityFixture(), {
        ignoredSignatures: [],
        mutedRules: ['never-activatable'],
      }),
    );
    expect(state.unfilteredRules().has('never-activatable')).toBe(true);
  });

  it('ignoreDiagnostic appends the signature through the workspace and drops the row', () => {
    workspace.activeProject.set(seededProject(severityFixture()));
    const target = state.diagnostics()[0];
    assert(target);

    state.ignoreDiagnostic(target);

    expect(workspace.activeProject()?.lintPrefs).toEqual({
      ignoredSignatures: ['invalid-regex|0|/servant(/'],
      mutedRules: [],
    });
    expect(state.diagnostics().map((d) => d.rule)).not.toContain('invalid-regex');
    expect(state.ignoredCount()).toBe(1);
  });

  it('ignoreDiagnostic is idempotent and writes nothing when already ignored', () => {
    workspace.activeProject.set(seededProject(severityFixture()));
    const target = state.diagnostics()[0];
    assert(target);
    state.ignoreDiagnostic(target);
    const projectAfterFirst = workspace.activeProject();

    state.ignoreDiagnostic(target);

    expect(workspace.activeProject()).toBe(projectAfterFirst);
    expect(workspace.activeProject()?.lintPrefs?.ignoredSignatures).toHaveLength(1);
  });

  it('undoAllIgnored clears ignored signatures and keeps mutes', () => {
    workspace.activeProject.set(seededProject(severityFixture()));
    const target = state.diagnostics()[0];
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

  it('setRuleMuted maps a user chip selection onto mutedRules', () => {
    workspace.activeProject.set(seededProject(severityFixture()));

    // Deselected chip = muted.
    state.setRuleMuted('never-activatable', chipChange(false));
    expect(workspace.activeProject()?.lintPrefs?.mutedRules).toEqual(['never-activatable']);
    expect(state.mutedRules().has('never-activatable')).toBe(true);
    expect(state.diagnostics().map((d) => d.rule)).not.toContain('never-activatable');

    // Re-selected chip = the check runs again.
    state.setRuleMuted('never-activatable', chipChange(true));
    // Empty sides stay as empty arrays: the prefs shape is stable once created.
    expect(workspace.activeProject()?.lintPrefs).toEqual({
      ignoredSignatures: [],
      mutedRules: [],
    });
    expect(state.diagnostics().map((d) => d.rule)).toContain('never-activatable');
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
