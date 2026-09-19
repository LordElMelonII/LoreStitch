import { TestBed } from '@angular/core/testing';
import {
  CharacterBookEntry,
  LintPrefs,
  ProjectWorkspace,
  createEmptyEntry,
} from '../../core/models/lorebook.model';
import { WorkspaceService } from '../../core/services/workspace.service';
import { LinterState } from './linter-state';

/** Builds an entry with sensible defaults for linter tests. */
function entry(id: number, overrides: Partial<CharacterBookEntry> = {}): CharacterBookEntry {
  return { ...createEmptyEntry(id), ...overrides };
}

function projectOf(entries: CharacterBookEntry[], lintPrefs?: LintPrefs): ProjectWorkspace {
  return {
    id: 'linter-state-project',
    title: 'Linter',
    createdAt: 1,
    updatedAt: 1,
    targetType: 'standalone_lorebook',
    activeBook: { name: 'Linter', extensions: {}, entries },
    headCommitId: null,
    commits: [],
    ...(lintPrefs ? { lintPrefs } : {}),
  };
}

/**
 * One entry per severity: an invalid regex key (error), a keyless entry with
 * no alternate activation source (warning), a selective entry with a key but
 * no secondary keys (info — keyed so `never-activatable` stays quiet).
 */
function severityFixture(): CharacterBookEntry[] {
  return [
    entry(0, { comment: 'Broken regex', keys: ['/servant(/'] }),
    entry(1, { comment: 'Keyless', keys: [] }),
    entry(2, { comment: 'Selective', keys: ['paris'], selective: true, secondary_keys: [] }),
  ];
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
    expect(state.issueCount()).toBe(0);
    expect(state.unfilteredRules().size).toBe(0);
    expect(state.ignoredCount()).toBe(0);
  });

  it('lints the active book once and memoizes across reads', () => {
    workspace.activeProject.set(projectOf(severityFixture()));

    const diagnostics = state.diagnostics();
    expect(state.diagnostics()).toBe(diagnostics); // same reference: memoized
    expect(diagnostics.map((d) => d.rule)).toEqual([
      'invalid-regex',
      'never-activatable',
      'selective-without-secondary',
    ]);
  });

  it('counts only errors and warnings for the badge — info never lights it', () => {
    workspace.activeProject.set(projectOf(severityFixture()));
    expect(state.issueCount()).toBe(2);

    workspace.activeProject.set(
      projectOf([entry(0, { keys: ['paris'], selective: true, secondary_keys: [] })]),
    );
    expect(state.issueCount()).toBe(0);
  });

  it('recomputes when the project signal changes', () => {
    workspace.activeProject.set(projectOf(severityFixture()));
    const before = state.diagnostics().length;

    workspace.activeProject.set(
      projectOf([
        entry(0, { comment: 'Clean', keys: ['paris'], content: 'Something else entirely.' }),
      ]),
    );
    expect(state.diagnostics().length).toBe(0);
    expect(before).toBe(3);
  });

  it('applies the project prefs: muted rules and ignored signatures never surface', () => {
    workspace.activeProject.set(
      projectOf(severityFixture(), {
        ignoredSignatures: ['invalid-regex|0|/servant(/'],
        mutedRules: ['never-activatable'],
      }),
    );

    expect(state.diagnostics().map((d) => d.rule)).toEqual(['selective-without-secondary']);
    // The badge follows the filtered result: muted/ignored issues never count.
    expect(state.issueCount()).toBe(0);
  });

  it('exposes the rules present in an unfiltered pass for the mute-chip row', () => {
    workspace.activeProject.set(projectOf(severityFixture()));

    const rules = state.unfilteredRules();
    expect(rules.has('invalid-regex')).toBe(true);
    expect(rules.has('never-activatable')).toBe(true);
    expect(rules.has('selective-without-secondary')).toBe(true);
    // Muted rules stay in the unfiltered set so their chips remain visible.
    workspace.activeProject.set(
      projectOf(severityFixture(), {
        ignoredSignatures: [],
        mutedRules: ['never-activatable'],
      }),
    );
    expect(state.unfilteredRules().has('never-activatable')).toBe(true);
  });

  it('ignoreDiagnostic appends the signature through the workspace and drops the row', () => {
    workspace.activeProject.set(projectOf(severityFixture()));
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
    workspace.activeProject.set(projectOf(severityFixture()));
    const target = state.diagnostics()[0];
    assert(target);
    state.ignoreDiagnostic(target);
    const projectAfterFirst = workspace.activeProject();

    state.ignoreDiagnostic(target);

    expect(workspace.activeProject()).toBe(projectAfterFirst);
    expect(workspace.activeProject()?.lintPrefs?.ignoredSignatures).toHaveLength(1);
  });

  it('undoAllIgnored clears ignored signatures and keeps mutes', () => {
    workspace.activeProject.set(projectOf(severityFixture()));
    const target = state.diagnostics()[0];
    assert(target);
    state.ignoreDiagnostic(target);
    state.toggleMutedRule('recursion-cycle');

    state.undoAllIgnored();

    expect(workspace.activeProject()?.lintPrefs).toEqual({
      ignoredSignatures: [],
      mutedRules: ['recursion-cycle'],
    });
    expect(state.ignoredCount()).toBe(0);
  });

  it('unmuteAll clears muted rules and keeps ignored signatures', () => {
    workspace.activeProject.set(
      projectOf(severityFixture(), {
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

  it('toggleMutedRule adds and removes a rule in mutedRules', () => {
    workspace.activeProject.set(projectOf(severityFixture()));

    state.toggleMutedRule('never-activatable');
    expect(workspace.activeProject()?.lintPrefs?.mutedRules).toEqual(['never-activatable']);
    expect(state.mutedRules().has('never-activatable')).toBe(true);
    expect(state.diagnostics().map((d) => d.rule)).not.toContain('never-activatable');

    state.toggleMutedRule('never-activatable');
    // Empty sides stay as empty arrays: the prefs shape is stable once created.
    expect(workspace.activeProject()?.lintPrefs).toEqual({
      ignoredSignatures: [],
      mutedRules: [],
    });
    expect(state.diagnostics().map((d) => d.rule)).toContain('never-activatable');
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
    state.toggleMutedRule('recursion-cycle');

    expect(workspace.activeProject()).toBeNull();
  });
});
