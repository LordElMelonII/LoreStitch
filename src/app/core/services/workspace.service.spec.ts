import { TestBed } from '@angular/core/testing';
import { WorkspaceService } from './workspace.service';
import { SAVE_DEBOUNCE_MS, StorageService } from './storage.service';
import { sessionLockName, SessionLockService } from './session-lock.service';
import { createEmptyBook, createEmptyEntry } from '../models/lorebook.model';
import type { BookRepair } from '../models/book-repair';
import { entryWith, projectOf } from '../../../testing/project-fixtures';
import {
  flushMicrotasks,
  installSessionLockFakes,
  type SessionLockFakes,
} from '../../../testing/session-lock-fakes';

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

  // The add-entry and delete-entry dirty cases are pinned by the two tests
  // above; this block pins the positional-isDirty decomposition (plan 18 D5)
  // that the whole-book serialization used to cover implicitly.
  describe('hasUnsavedChanges decomposition (plan 18 D5)', () => {
    it('catches a reorder-only change that dirtyEntryIds is silent on', async () => {
      await workspace.createProject('Fuyuki', 'standalone_lorebook');
      const first = workspace.addEntry();
      const second = workspace.addEntry();
      workspace.updateEntry(first, { content: 'first' });
      workspace.updateEntry(second, { content: 'second' });
      await workspace.commit('two entries');
      expect(workspace.hasUnsavedChanges()).toBe(false);

      // Swap the two entries' positions without touching their values: the
      // same entry objects in a different order.
      workspace.activeProject.update((p) => {
        if (!p) return p;
        const entries = [...p.activeBook.entries].reverse();
        return { ...p, activeBook: { ...p.activeBook, entries } };
      });

      // The positional compare catches the reorder; the id-matched
      // `dirtyEntryIds` is silent on it (identical values per id) — exactly
      // the documented gap the shell+count+positional decomposition closes.
      expect(workspace.hasUnsavedChanges()).toBe(true);
      expect(workspace.dirtyEntryIds().size).toBe(0);
    });

    it('catches a book-field-only patch through updateBook', async () => {
      await workspace.createProject('Fuyuki', 'standalone_lorebook');
      workspace.addEntry();
      await workspace.commit('entry');
      expect(workspace.hasUnsavedChanges()).toBe(false);

      // A book-level field change with no entry change at all: only the
      // shell (the book minus its entries) differs from HEAD.
      workspace.updateBook({ token_budget: 4096 });

      expect(workspace.hasUnsavedChanges()).toBe(true);
      expect(workspace.dirtyEntryIds().size).toBe(0);
    });

    it('stays clean when a new project reference is book-identical', async () => {
      await workspace.createProject('Fuyuki', 'standalone_lorebook');
      workspace.addEntry();
      await workspace.commit('entry');
      expect(workspace.hasUnsavedChanges()).toBe(false);

      // A mutation outside the book (metadata only): same activeBook
      // reference, so the shell and every positional compare are memo hits.
      workspace.activeProject.update((p) => (p ? { ...p, updatedAt: p.updatedAt + 1 } : p));

      expect(workspace.hasUnsavedChanges()).toBe(false);
    });
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

  it('imports an archive when the Web Locks API is absent (proceed, status quo)', async () => {
    const lock = TestBed.inject(SessionLockService);
    const imported = projectOf([entryWith(0)], { id: 'imported-absent', title: 'Imported' });

    await workspace.openImportedWorkspace(imported);

    expect(workspace.activeProject()?.id).toBe('imported-absent');
    // Without locks the attach degraded straight to held — edits allowed.
    expect(lock.canEdit()).toBe(true);
  });
});

/**
 * Write gating (task 11 §3.2, §3.6 unit matrix row 2): with the Web Locks
 * fakes installed, another tab holding the project's lock turns every
 * persisted write path into a no-op + `blockedAttempt` pulse, while tab
 * bookkeeping and fresh-project creation keep working.
 */
describe('WorkspaceService session-lock gating', () => {
  let workspace: WorkspaceService;
  let lock: SessionLockService;
  let fakes: SessionLockFakes;

  beforeEach(async () => {
    fakes = installSessionLockFakes();
    TestBed.configureTestingModule({});
    workspace = TestBed.inject(WorkspaceService);
    lock = TestBed.inject(SessionLockService);
    // Allow the async init() to finish (no saved projects in a fresh store).
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  afterEach(() => {
    lock.detach();
    fakes.restore();
  });

  /**
   * Flips the active project's lock to `blocked`: closes (flush + release,
   * drained), arms a phantom foreign holder that grabs whatever name the next
   * request asks for, and re-opens. Returns the phantom's release.
   */
  async function blockActiveProject(): Promise<() => void> {
    const project = workspace.activeProject();
    assert(project);
    await workspace.closeProject();
    // Let the detach's flush-then-release chain finish before arming the
    // phantom, so the old hold's release cannot wipe the phantom's grab.
    await flushMicrotasks();
    const phantom = fakes.locks.holdNext();
    await workspace.openProject(project.id);
    await flushMicrotasks();
    expect(lock.state()).toBe('blocked');
    return () => phantom.release();
  }

  it('no-ops and pulses mutateProject/commit/rollbackTo/deleteProject while blocked', async () => {
    await workspace.createProject('Held', 'standalone_lorebook');
    const entryId = workspace.addEntry();
    const project = workspace.activeProject();
    assert(project);
    const commitCount = project.commits.length;
    const release = await blockActiveProject();

    const pulses = lock.blockedAttempt();
    workspace.renameProject('Should Not Apply');
    expect(workspace.activeProject()?.title).toBe('Held');

    await expect(workspace.commit('blocked commit')).resolves.toBe(false);
    assert(project.commits[0]);
    await expect(workspace.rollbackTo(project.commits[0].id)).resolves.toBe(false);
    expect(workspace.activeProject()?.commits).toHaveLength(commitCount);

    await workspace.deleteProject(project.id);
    // Destructive, gated: the project survives and stays active.
    expect(workspace.activeProject()?.id).toBe(project.id);
    const storage = TestBed.inject(StorageService);
    await expect(storage.getProject(project.id)).resolves.toBeDefined();

    workspace.updateEntry(entryId, { content: 'typed into the void' });
    expect(workspace.entries()[0]?.content).not.toBe('typed into the void');

    // One pulse per gated attempt, in order.
    expect(lock.blockedAttempt()).toBe(pulses + 5);
    release();
  });

  it('keeps tab bookkeeping live while blocked (browsing a read-only tab is harmless)', async () => {
    await workspace.createProject('Held', 'standalone_lorebook');
    const entryId = workspace.addEntry();
    workspace.closeTab(entryId);
    const release = await blockActiveProject();

    workspace.openEntry(entryId);
    expect(workspace.activeTabId()).toBe(entryId);
    expect(workspace.openTabEntryIds()).toContain(entryId);
    expect(lock.blockedAttempt()).toBe(0);
    release();
  });

  it('gates writes after a takeover handed the lock away (lost), with the handshake flush first', async () => {
    await workspace.createProject('Mine', 'standalone_lorebook');
    const project = workspace.activeProject();
    assert(project);
    const flushSpy = vi.spyOn(workspace, 'flushPendingSave');

    // The other tab's takeover handshake reaches this (holder) tab.
    const channel = fakes.channels[0];
    assert(channel);
    channel.receive({ type: 'takeover-request', projectId: project.id });
    expect(lock.state()).toBe('relinquishing');
    await flushMicrotasks();
    expect(lock.state()).toBe('lost');
    // Non-destructive pin: the registered flush ran before the release.
    expect(flushSpy).toHaveBeenCalledTimes(1);
    expect(fakes.locks.isHeld(sessionLockName(project.id))).toBe(false);
    flushSpy.mockRestore();

    const pulses = lock.blockedAttempt();
    workspace.renameProject('Should Not Apply');
    expect(workspace.activeProject()?.title).toBe('Mine');
    expect(lock.blockedAttempt()).toBe(pulses + 1);
  });

  it('gates writes while a handshake flush is still in flight (relinquishing)', async () => {
    await workspace.createProject('Mine', 'standalone_lorebook');
    const project = workspace.activeProject();
    assert(project);
    const hanging = new Promise<void>(() => undefined);
    const flushSpy = vi.spyOn(workspace, 'flushPendingSave').mockReturnValue(hanging);

    const channel = fakes.channels[0];
    assert(channel);
    channel.receive({ type: 'takeover-request', projectId: project.id });
    expect(lock.state()).toBe('relinquishing');
    expect(lock.canEdit()).toBe(false);

    const pulses = lock.blockedAttempt();
    workspace.renameProject('Should Not Apply');
    expect(workspace.activeProject()?.title).toBe('Mine');
    expect(lock.blockedAttempt()).toBe(pulses + 1);

    flushSpy.mockRestore();
    // The flush never settles (hung hook): free the fake lock so nothing is
    // left held across tests.
    fakes.locks.forceRelease(sessionLockName(project.id));
  });

  it('confines a write that slipped through while acquiring; its debounced save never lands (§7.3)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    try {
      const phantom = fakes.locks.holdNext();
      const id = 'slipped-project';
      // Built directly (not through createProject) so the lock attaches while
      // the phantom already grabs the FIRST probe: the tab boots into
      // `acquiring` — writes allowed — and settles `blocked`.
      workspace.activeProject.set(projectOf([entryWith(0, { content: 'local' })], { id, title: 'Slipped' }));
      lock.attach(id, { flush: () => workspace.flushPendingSave() });
      expect(lock.state()).toBe('acquiring');
      expect(lock.canEdit()).toBe(true);

      workspace.updateEntry(0, { content: 'typed in the acquiring window' });
      expect(workspace.entries()[0]?.content).toBe('typed in the acquiring window');

      await flushMicrotasks();
      expect(lock.state()).toBe('blocked');
      expect(lock.canEdit()).toBe(false);

      // The debounced save fires while gated: dropped, and the stale snapshot
      // is retired so storage truth is served (the "gated keystrokes heal"
      // precondition for the shell's reload-on-acquire).
      await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
      const storage = TestBed.inject(StorageService);
      await expect(storage.getProject(id)).resolves.toBeUndefined();
      // The edit stays confined to memory.
      expect(workspace.entries()[0]?.content).toBe('typed in the acquiring window');

      // Any further attempt is gated and pulses.
      const pulses = lock.blockedAttempt();
      workspace.updateEntry(0, { content: 'nope' });
      expect(workspace.entries()[0]?.content).toBe('typed in the acquiring window');
      expect(lock.blockedAttempt()).toBe(pulses + 1);
      phantom.release();
      await flushMicrotasks();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a blocked tab can still create a new project and edit it (fresh uuid lock)', async () => {
    await workspace.createProject('First', 'standalone_lorebook');
    const release = await blockActiveProject();
    expect(lock.state()).toBe('blocked');

    await workspace.createProject('Second', 'standalone_lorebook');
    // A fresh uuid's lock is free: the new project is fully editable.
    expect(lock.state()).toBe('held');
    expect(lock.canEdit()).toBe(true);
    const entryId = workspace.addEntry();
    expect(entryId).toBe(0);
    expect(workspace.entries()).toHaveLength(1);
    release();
  });

  it('a blocked tab can still start a project from a book (fresh uuid lock)', async () => {
    await workspace.createProject('First', 'standalone_lorebook');
    const release = await blockActiveProject();

    await workspace.startProjectFromBook('From Book', createEmptyBook('From Book'));
    expect(lock.state()).toBe('held');
    expect(workspace.activeProject()?.title).toBe('From Book');
    release();
  });

  it('refuses to import an archive whose project id another tab holds (checkpoint 11-1)', async () => {
    const releaseHolder = await fakes.locks.holdFromOutside(sessionLockName('imported-1'));
    const storage = TestBed.inject(StorageService);
    const saveSpy = vi.spyOn(storage, 'saveProject');
    const imported = projectOf([entryWith(0), entryWith(1)], { id: 'imported-1', title: 'Imported' });

    const pulses = lock.blockedAttempt();
    await workspace.openImportedWorkspace(imported);

    // Aborted before anything persisted or any state changed.
    expect(saveSpy).not.toHaveBeenCalled();
    expect(workspace.activeProject()).toBeNull();
    expect(workspace.savedProjects()).toEqual([]);
    expect(lock.state()).toBe('idle');
    // Exactly one pulse through the read-only chokepoint.
    expect(lock.blockedAttempt()).toBe(pulses + 1);
    // The probe rode an ifAvailable request on the held id's lock name.
    expect(fakes.locks.requests.at(-1)).toMatchObject({
      name: sessionLockName('imported-1'),
      ifAvailable: true,
    });
    releaseHolder();
  });

  it('imports an archive whose project id is free and acquires its lock', async () => {
    const imported = projectOf([entryWith(0), entryWith(1)], { id: 'imported-2', title: 'Imported' });
    const pulses = lock.blockedAttempt();

    await workspace.openImportedWorkspace(imported);

    expect(workspace.activeProject()?.id).toBe('imported-2');
    expect(workspace.entries()).toHaveLength(2);
    // setActive attached and acquired the archive id's lock.
    expect(lock.state()).toBe('held');
    expect(lock.canEdit()).toBe(true);
    expect(fakes.locks.isHeld(sessionLockName('imported-2'))).toBe(true);
    // A free id never pulses the read-only chokepoint.
    expect(lock.blockedAttempt()).toBe(pulses);
  });

  it('re-importing the archive of the project this tab holds proceeds (self-held is not elsewhere)', async () => {
    await workspace.createProject('Open', 'standalone_lorebook');
    const id = workspace.activeProject()?.id;
    assert(id);
    const pulses = lock.blockedAttempt();

    await workspace.openImportedWorkspace(projectOf([entryWith(0)], { id, title: 'Re-imported' }));

    expect(workspace.activeProject()?.title).toBe('Re-imported');
    // Same-id re-open: no lock churn, no pulse.
    expect(lock.state()).toBe('held');
    expect(lock.blockedAttempt()).toBe(pulses);
  });
});
