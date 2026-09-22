import { CharacterBookEntry, createEmptyEntry } from '../app/core/models/lorebook.model';
import type { LintPrefs, ProjectWorkspace } from '../app/core/models/project.model';

export interface ProjectFixtureOptions {
  id?: string;
  title?: string;
  /** Book name; defaults to the title. */
  bookName?: string;
  lintPrefs?: LintPrefs;
  tokenBudget?: number;
}

/**
 * Builds a standalone-lorebook workspace holding exactly `entries`. Component
 * specs previously each carried a private near-identical copy of this builder;
 * pass each spec's original id/title via `opts` to keep fixtures stable.
 */
export function projectOf(
  entries: CharacterBookEntry[],
  opts: ProjectFixtureOptions = {},
): ProjectWorkspace {
  const title = opts.title ?? 'Test';
  return {
    id: opts.id ?? 'test-project',
    title,
    createdAt: 1,
    updatedAt: 1,
    targetType: 'standalone_lorebook',
    activeBook: {
      name: opts.bookName ?? title,
      extensions: {},
      entries,
      ...(opts.tokenBudget === undefined ? {} : { token_budget: opts.tokenBudget }),
    },
    headCommitId: null,
    commits: [],
    ...(opts.lintPrefs ? { lintPrefs: opts.lintPrefs } : {}),
  };
}

/** Builds an entry with sensible defaults for spec fixtures. */
export function entryWith(id: number, overrides: Partial<CharacterBookEntry> = {}): CharacterBookEntry {
  return { ...createEmptyEntry(id), ...overrides };
}

/**
 * One entry per severity for linter UI specs: an invalid regex key (error), a
 * keyless entry with no alternate activation source (warning), a selective
 * entry with a key but no secondary keys (info — keyed so `never-activatable`
 * stays quiet).
 */
export function severityFixture(): CharacterBookEntry[] {
  return [
    entryWith(0, { comment: 'Broken regex', keys: ['/servant(/'] }),
    entryWith(1, { comment: 'Keyless', keys: [] }),
    entryWith(2, { comment: 'Selective', keys: ['paris'], selective: true, secondary_keys: [] }),
  ];
}
