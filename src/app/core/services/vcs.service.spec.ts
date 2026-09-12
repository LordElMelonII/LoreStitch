import { TestBed } from '@angular/core/testing';
import { ProjectWorkspace, createEmptyBook, createEmptyEntry } from '../models/lorebook.model';
import { VcsService } from './vcs.service';

function makeProject(): ProjectWorkspace {
  const now = Date.now();
  const book = createEmptyBook('Test');
  book.entries = [createEmptyEntry(0)];
  return {
    id: 'test-project',
    title: 'Test Project',
    createdAt: now,
    updatedAt: now,
    targetType: 'standalone_lorebook',
    activeBook: book,
    headCommitId: null,
    commits: [],
  };
}

describe('VcsService', () => {
  let vcs: VcsService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    vcs = TestBed.inject(VcsService);
  });

  describe('createCommit', () => {
    it('stores a full snapshot, timestamp and moves HEAD', async () => {
      const project = makeProject();
      const committed = await vcs.createCommit(project, 'first');

      expect(committed.commits).toHaveLength(1);
      const commit = committed.commits[0];
      expect(commit.id).toMatch(/^[0-9a-f]{64}$/);
      expect(commit.parentId).toBeNull();
      expect(commit.message).toBe('first');
      expect(commit.snapshot).toEqual(project.activeBook);
      expect(committed.headCommitId).toBe(commit.id);
      // Input is not mutated.
      expect(project.commits).toHaveLength(0);
      expect(project.headCommitId).toBeNull();
    });

    it('produces different hashes for different content and parent', async () => {
      const project = makeProject();
      const first = await vcs.createCommit(project, 'first');

      const changed: ProjectWorkspace = {
        ...first,
        activeBook: {
          ...first.activeBook,
          entries: [createEmptyEntry(0), createEmptyEntry(1)],
        },
      };
      const second = await vcs.createCommit(changed, 'second');

      expect(second.commits[1].parentId).toBe(first.headCommitId);
      expect(second.commits[1].id).not.toBe(first.headCommitId);

      // Same content with a different parent hashes differently.
      const other = await vcs.createCommit(
        { ...second, activeBook: first.activeBook },
        'back to first state',
      );
      expect(other.headCommitId).not.toBe(first.headCommitId);
    });

    it('is deterministic for identical content and parent', async () => {
      const a = await vcs.createCommit(makeProject(), 'same');
      const b = await vcs.createCommit(makeProject(), 'same');
      expect(a.headCommitId).toBe(b.headCommitId);
    });
  });

  describe('rollbackToCommit', () => {
    it('restores the snapshot and records a revert commit', async () => {
      let project = makeProject();
      const original = await vcs.createCommit(project, 'original state');
      project = original;

      const modified: ProjectWorkspace = {
        ...project,
        activeBook: { ...project.activeBook, entries: [] },
      };
      project = await vcs.createCommit(modified, 'deleted everything');

      // Roll back to the first commit, whose snapshot still has one entry.
      const originalId = project.commits[0].id;
      const { project: rolled } = await vcs.rollbackToCommit(project, originalId);

      expect(rolled.activeBook.entries).toHaveLength(1);
      expect(rolled.commits).toHaveLength(3);
      const revert = rolled.commits[2];
      expect(revert.message).toContain('Revert to');
      // The revert message names the commit being restored.
      expect(revert.message).toContain('original state');
      expect(revert.parentId).toBe(project.headCommitId);
      expect(rolled.headCommitId).toBe(revert.id);
    });

    it('returns the project untouched for an unknown commit id', async () => {
      const project = makeProject();
      const { project: same, commit } = await vcs.rollbackToCommit(project, 'nope');
      expect(commit).toBeNull();
      expect(same).toBe(project);
    });
  });

  describe('dirty tracking', () => {
    it('is dirty before any commit and clean right after', async () => {
      const project = makeProject();
      expect(vcs.isDirty(project)).toBe(true);

      const committed = await vcs.createCommit(project, 'first');
      expect(vcs.isDirty(committed)).toBe(false);
    });

    it('marks exactly the edited entry ids as dirty', async () => {
      const project = makeProject();
      project.activeBook.entries.push(createEmptyEntry(1));
      const committed = await vcs.createCommit(project, 'two entries');

      const edited: ProjectWorkspace = {
        ...committed,
        activeBook: {
          ...committed.activeBook,
          entries: committed.activeBook.entries.map((e) =>
            e.id === 1 ? { ...e, content: 'changed' } : e,
          ),
        },
      };

      const dirty = vcs.dirtyEntryIds(edited);
      expect(dirty.has(1)).toBe(true);
      expect(dirty.has(0)).toBe(false);
      expect(vcs.isDirty(edited)).toBe(true);
    });
  });
});
