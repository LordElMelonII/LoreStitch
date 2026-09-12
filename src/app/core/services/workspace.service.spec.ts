import { TestBed } from '@angular/core/testing';
import { WorkspaceService } from './workspace.service';
import { StorageService } from './storage.service';
import { VcsService } from './vcs.service';
import { createEmptyBook, createEmptyEntry } from '../models/lorebook.model';

/**
 * The WorkspaceService tests run against the in-memory fallback of the
 * StorageService (jsdom has no IndexedDB), which keeps the session usable and
 * is exactly what private-browsing users get.
 */
describe('WorkspaceService', () => {
  let workspace: WorkspaceService;

  beforeEach(async () => {
    TestBed.configureTestingModule({});
    workspace = TestBed.inject(WorkspaceService);
    // Allow the async init() to finish (no saved projects in a fresh store).
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('creates a project with an initial commit and opens editor tabs lazily', async () => {
    await workspace.createProject('Fuyuki', 'standalone_lorebook');

    const project = workspace.activeProject();
    expect(project).not.toBeNull();
    expect(project!.title).toBe('Fuyuki');
    expect(project!.commits).toHaveLength(1);
    expect(project!.headCommitId).toBe(project!.commits[0].id);
    expect(workspace.hasUnsavedChanges()).toBe(false);
  });

  it('tracks entry mutations, dirty state and tab state', async () => {
    await workspace.createProject('Fuyuki', 'standalone_lorebook');
    const id = workspace.addEntry();

    expect(id).toBe(0);
    expect(workspace.entries()).toHaveLength(1);
    expect(workspace.activeTabId()).toBe(0);
    expect(workspace.dirtyEntryIds().has(0)).toBe(true);
    expect(workspace.hasUnsavedChanges()).toBe(true);

    workspace.updateEntry(id, { content: 'Sakura lives in the Matou house.' });
    expect(workspace.entries()[0].content).toContain('Matou');

    workspace.closeTab(id);
    expect(workspace.openTabEntryIds()).toEqual([]);
    expect(workspace.activeTabId()).toBeNull();
    expect(workspace.activeEntry()).toBeNull();
  });

  it('commit clears dirty state; rollback restores deleted entries', async () => {
    await workspace.createProject('Fuyuki', 'standalone_lorebook');
    const id = workspace.addEntry();
    await workspace.commit('add entry');
    expect(workspace.hasUnsavedChanges()).toBe(false);
    expect(workspace.activeProject()!.commits).toHaveLength(2);

    workspace.deleteEntry(id);
    expect(workspace.entries()).toHaveLength(0);
    expect(workspace.hasUnsavedChanges()).toBe(true);

    const previousHead = workspace.activeProject()!.commits[1].id;
    await workspace.rollbackTo(previousHead);
    expect(workspace.entries()).toHaveLength(1);
    expect(workspace.activeProject()!.commits).toHaveLength(3);
    expect(workspace.activeProject()!.commits[2].message).toContain('Revert to');
  });

  it('duplicates entries with fresh ids after the current maximum', async () => {
    await workspace.createProject('Fuyuki', 'standalone_lorebook');
    workspace.activeProject.update((p) => {
      if (!p) return p;
      const book = createEmptyBook('Fuyuki');
      book.entries = [createEmptyEntry(5), createEmptyEntry(9)];
      return { ...p, activeBook: book };
    });

    workspace.duplicateEntry(5);
    const entries = workspace.entries();
    // The copy is inserted right after its source: [5, copy, 9].
    expect(entries).toHaveLength(3);
    expect(entries[1].id).toBe(10);
    expect(entries[1].comment).toContain('(copy)');
    expect(entries[2].id).toBe(9);
  });

  it('persists new projects into the storage layer', async () => {
    await workspace.createProject('Persisted', 'standalone_lorebook');
    await workspace.flushPendingSave();
    const storage = TestBed.inject(StorageService);
    const saved = await storage.getProject(workspace.activeProject()!.id);
    expect(saved?.title).toBe('Persisted');
  });

  it('replaces the working book (merge result)', async () => {
    await workspace.createProject('Fuyuki', 'standalone_lorebook');
    const book = createEmptyBook('Fuyuki');
    book.entries = [createEmptyEntry(0, 0), createEmptyEntry(1, 1)];
    workspace.replaceBook(book);
    expect(workspace.entries()).toHaveLength(2);
  });
});
