import { TestBed } from '@angular/core/testing';
import { WorkspaceService } from './workspace.service';
import { StorageService } from './storage.service';
import { createEmptyBook, createEmptyEntry } from '../models/lorebook.model';
import type { BookRepair } from '../models/book-repair';

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

  it('applyBookRepair replaces the active book, marks the tree dirty and schedules the save', async () => {
    await workspace.createProject('Fuyuki', 'standalone_lorebook');
    const storage = TestBed.inject(StorageService);
    const scheduleSave = vi.spyOn(storage, 'scheduleSave');
    const before = workspace.activeProject();
    assert(before);

    const book = createEmptyBook('Repaired');
    book.entries = [createEmptyEntry(0, 0)];
    const repair: BookRepair = {
      book,
      changes: [{ kind: 'coerce-id', entryTitle: 'Tavern', from: '"0"', to: '0' }],
    };

    workspace.applyBookRepair(repair);

    const after = workspace.activeProject();
    assert(after);
    expect(after.activeBook).toBe(book);
    expect(workspace.hasUnsavedChanges()).toBe(true);
    // The debounced persistence fired with the repaired tree.
    expect(scheduleSave).toHaveBeenCalledWith(after);
    // History is untouched — the commits array keeps its identity.
    expect(after.commits).toBe(before.commits);
  });

  it('applyBookRepair with a selection folds the sub-book plan back onto the mapped parent entries only', async () => {
    await workspace.createProject('Fuyuki', 'standalone_lorebook');
    const first = createEmptyEntry(1, 0);
    const second = { ...createEmptyEntry(2, 1), priority: Number.POSITIVE_INFINITY };
    const third = createEmptyEntry(3, 2);
    (third as unknown as Record<string, unknown>)['plugin_note'] = 'hand-edited';
    workspace.replaceBook({ ...createEmptyBook('Fuyuki'), entries: [first, second, third] });

    // The plan is over the sub-book of the selection [2, 3] — `extractSubBook`
    // order, i.e. parent book order: order defaulted on the first sub entry,
    // the second renumbered. Everything else in the plan is a no-op.
    const subFirst = { ...structuredClone(second), insertion_order: 100 };
    const subSecond = { ...structuredClone(third), id: 9 };
    const repair: BookRepair = {
      book: { ...createEmptyBook('Split'), entries: [subFirst, subSecond] },
      changes: [
        { kind: 'default-insertion-order', entryTitle: 'Two', from: '∞', to: '100' },
        { kind: 'reassign-id', entryTitle: 'Three', from: '3', to: '9' },
      ],
    };

    workspace.applyBookRepair(repair, [2, 3]);

    const entries = workspace.entries();
    expect(entries).toHaveLength(3);
    // Unselected entry untouched (same reference — no rebuild).
    expect(entries[0]).toBe(first);
    // First sub entry folded back onto parent entry 2: order patched, every
    // unflagged field (id, the infinite priority) kept as is.
    const patchedSecond = entries[1];
    assert(patchedSecond);
    expect(patchedSecond.id).toBe(2);
    expect(patchedSecond.insertion_order).toBe(100);
    expect(patchedSecond.priority).toBe(Number.POSITIVE_INFINITY);
    // Second sub entry folded back onto parent entry 3: id renumbered, the
    // unknown vendor key rides along verbatim.
    const patchedThird = entries[2];
    assert(patchedThird);
    expect(patchedThird.id).toBe(9);
    expect(patchedThird.insertion_order).toBe(third.insertion_order);
    expect((patchedThird as unknown as Record<string, unknown>)['plugin_note']).toBe('hand-edited');
    // A repair is a working-tree edit like any other: dirty and committable.
    expect(workspace.hasUnsavedChanges()).toBe(true);
  });

  it('reports a save failure when browser storage rejects writes', async () => {
    await workspace.createProject('Doomed', 'standalone_lorebook');
    // jsdom has no IndexedDB, so the initial write fails and must surface.
    expect(workspace.saveError()).toBe(
      'Latest changes could not be saved to browser storage. Export your work to avoid data loss.',
    );
  });
});
