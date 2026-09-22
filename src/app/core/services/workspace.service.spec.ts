import { TestBed } from '@angular/core/testing';
import { WorkspaceService } from './workspace.service';
import { StorageService } from './storage.service';
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
    assert(project);
    expect(project.title).toBe('Fuyuki');
    expect(project.commits).toHaveLength(1);
    assert(project.commits[0]);
    expect(project.headCommitId).toBe(project.commits[0].id);
    expect(workspace.hasUnsavedChanges()).toBe(false);
    // Lazy tabs: a fresh project starts with no editor tabs open at all.
    expect(workspace.openTabEntryIds()).toEqual([]);
    expect(workspace.activeTabId()).toBeNull();
    expect(workspace.activeEntry()).toBeNull();
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
    const updated = workspace.entries()[0];
    assert(updated);
    expect(updated.content).toContain('Matou');

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
    const committed = workspace.activeProject();
    assert(committed);
    expect(committed.commits).toHaveLength(2);

    workspace.deleteEntry(id);
    expect(workspace.entries()).toHaveLength(0);
    expect(workspace.hasUnsavedChanges()).toBe(true);

    assert(committed.commits[1]);
    const previousHead = committed.commits[1].id;
    await workspace.rollbackTo(previousHead);
    expect(workspace.entries()).toHaveLength(1);
    const rolled = workspace.activeProject();
    assert(rolled);
    expect(rolled.commits).toHaveLength(3);
    assert(rolled.commits[2]);
    expect(rolled.commits[2].message).toContain('Revert to');
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
    assert(entries[1]);
    assert(entries[2]);
    expect(entries[1].id).toBe(10);
    expect(entries[1].comment).toContain('(copy)');
    expect(entries[2].id).toBe(9);
  });

  it('persists new projects into the storage layer', async () => {
    await workspace.createProject('Persisted', 'standalone_lorebook');
    await workspace.flushPendingSave();
    const storage = TestBed.inject(StorageService);
    const project = workspace.activeProject();
    assert(project);
    const saved = await storage.getProject(project.id);
    expect(saved?.title).toBe('Persisted');
  });

  it('carries the card shell from startProjectFromBook into the stored project', async () => {
    // Plan 15 §3.3: the shell is project birth metadata — the narrow mutator
    // (never a feature-side direct write) puts it on the record before the
    // initial save, so card exports find it on the stored project.
    const book = createEmptyBook('Card Book');
    book.entries = [createEmptyEntry(0, 0)];
    const cardShell = {
      spec: 'chara_card_v2' as const,
      cardJson: '{"spec":"chara_card_v2"}',
      pngKeyword: 'chara' as const,
      pngBytes: Uint8Array.of(0x89, 0x50),
    };

    await workspace.startProjectFromBook('Saber Card', book, cardShell);

    const project = workspace.activeProject();
    assert(project);
    expect(project.cardShell).toEqual(cardShell);
    await workspace.flushPendingSave();
    const storage = TestBed.inject(StorageService);
    const saved = await storage.getProject(project.id);
    expect(saved?.cardShell).toEqual(cardShell);
  });

  it('omits the cardShell key for shell-less starts', async () => {
    await workspace.startProjectFromBook('Bare', createEmptyBook('Bare'));
    const project = workspace.activeProject();
    assert(project);
    expect(Object.hasOwn(project, 'cardShell')).toBe(false);
  });

  it('replaces the working book (merge result)', async () => {
    await workspace.createProject('Fuyuki', 'standalone_lorebook');
    const book = createEmptyBook('Fuyuki');
    book.entries = [createEmptyEntry(0, 0), createEmptyEntry(1, 1)];
    workspace.replaceBook(book);
    expect(workspace.entries()).toHaveLength(2);
  });

  it('reports a save failure when browser storage rejects writes', async () => {
    await workspace.createProject('Doomed', 'standalone_lorebook');
    // jsdom has no IndexedDB, so the initial write fails and must surface.
    expect(workspace.saveError()).toBe(
      'Latest changes could not be saved to browser storage. Export your work to avoid data loss.',
    );
  });
});
