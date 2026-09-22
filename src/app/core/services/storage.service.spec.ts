import { TestBed } from '@angular/core/testing';
import { createEmptyBook, createEmptyEntry } from '../models/lorebook.model';
import { ProjectWorkspace } from '../models/project.model';
import { SAVE_DEBOUNCE_MS, StorageService } from './storage.service';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface PutRecord {
  readonly value: ProjectWorkspace;
  readonly deferred: Deferred<void>;
}

/**
 * In-memory stand-in for the IndexedDB store. `put` parks on a deferred so
 * tests decide when (and whether) a write commits, which is what makes the
 * overlapping-transaction race reproducible.
 */
const fakeDb = {
  store: new Map<string, ProjectWorkspace>(),
  state: new Map<string, unknown>(),
  puts: new Array<PutRecord>(),
  reset(): void {
    this.store.clear();
    this.state.clear();
    this.puts = [];
  },
  async get(store: string, id: string): Promise<unknown> {
    if (store === 'appState') {
      return this.state.get(id);
    }
    return this.store.get(id);
  },
  async put(_store: string, value: ProjectWorkspace, key?: IDBValidKey): Promise<void> {
    // appState writes are out-of-band metadata (explicit key, no races under
    // test) — they commit immediately.
    if (key !== undefined) {
      this.state.set(String(key), value);
      return;
    }
    const deferred = createDeferred<void>();
    this.puts.push({ value, deferred });
    // The value only becomes readable once the write commits; rejections
    // are observed by the service under test.
    void deferred.promise.then(
      () => this.store.set(value.id, value),
      () => undefined,
    );
    return deferred.promise;
  },
  async delete(_store: string, id: string): Promise<void> {
    this.store.delete(id);
  },
  /** Emulates the `by-updatedAt` index: ascending by `updatedAt`. */
  async getAllFromIndex(): Promise<ProjectWorkspace[]> {
    return [...this.store.values()].sort((a, b) => a.updatedAt - b.updatedAt);
  },
};

function makeProject(title: string): ProjectWorkspace {
  const now = Date.now();
  const book = createEmptyBook(title);
  book.entries = [createEmptyEntry(0)];
  return {
    id: 'project-1',
    title,
    createdAt: now,
    updatedAt: now,
    targetType: 'standalone_lorebook',
    activeBook: book,
    headCommitId: null,
    commits: [],
  };
}

/** Drains pending promise callbacks (fake timers do not flush microtasks). */
async function flushMicrotasks(): Promise<void> {
  for (let round = 0; round < 5; round += 1) {
    await Promise.resolve();
  }
}

describe('StorageService', () => {
  let storage: StorageService;

  beforeEach(() => {
    vi.useFakeTimers();
    fakeDb.reset();
    TestBed.configureTestingModule({});
    storage = TestBed.inject(StorageService);
    // Swap the private db handle for the fake store directly. Routing the
    // tests through `vi.mock('idb')` proved racy: the module mock is applied
    // during test-file transform, and under parallel workers it can miss —
    // leaving the real openDB to reject against jsdom's missing indexedDB.
    (storage as unknown as { db: Promise<typeof fakeDb> }).db = Promise.resolve(fakeDb);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the newer debounced snapshot when an older put settles late', async () => {
    const first = makeProject('first');
    const second: ProjectWorkspace = { ...first, title: 'second', updatedAt: first.updatedAt + 1 };

    storage.scheduleSave(first);
    // The debounce elapses and the first put goes out, stalling in flight.
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    await flushMicrotasks();
    expect(fakeDb.puts).toHaveLength(1);

    // A user edit lands while that put is still in flight.
    storage.scheduleSave(second);

    // The stale put commits; it must not retire the newer ticket.
    assert(fakeDb.puts[0]);
    fakeDb.puts[0].deferred.resolve();
    await flushMicrotasks();
    await expect(storage.getProject(first.id)).resolves.toBe(second);

    // The newer snapshot is still persisted when its own timer fires.
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    await flushMicrotasks();
    expect(fakeDb.puts.map((put) => put.value.title)).toEqual(['first', 'second']);
    assert(fakeDb.puts[1]);
    fakeDb.puts[1].deferred.resolve();
    await flushMicrotasks();
    expect(fakeDb.store.get(first.id)?.title).toBe('second');
  });

  it('publishes a persistence failure and clears it after a successful put', async () => {
    const project = makeProject('quota victim');
    const failure = new Error('QuotaExceededError');

    const firstAttempt = storage.saveProject(project);
    await flushMicrotasks();
    expect(fakeDb.puts).toHaveLength(1);
    assert(fakeDb.puts[0]);
    fakeDb.puts[0].deferred.reject(failure);
    // The failure is swallowed for the caller (session stays usable)...
    await expect(firstAttempt).resolves.toBeUndefined();
    // ...but surfaced on the service.
    expect(storage.saveError()).toBe(failure);

    const retry = storage.saveProject(project);
    await flushMicrotasks();
    assert(fakeDb.puts[1]);
    fakeDb.puts[1].deferred.resolve();
    await expect(retry).resolves.toBeUndefined();
    expect(storage.saveError()).toBeNull();
  });

  it('serves a pending debounced snapshot before the older persisted copy', async () => {
    const persisted = makeProject('persisted');
    const write = storage.saveProject(persisted);
    await flushMicrotasks();
    assert(fakeDb.puts[0]);
    fakeDb.puts[0].deferred.resolve();
    await write;
    await flushMicrotasks();

    const newer: ProjectWorkspace = {
      ...persisted,
      title: 'newer',
      updatedAt: persisted.updatedAt + 1,
    };
    storage.scheduleSave(newer); // still inside the debounce window
    await expect(storage.getProject(persisted.id)).resolves.toBe(newer);
  });

  it('collapses a burst of scheduleSave calls into the latest snapshot', async () => {
    const first = makeProject('first');
    const second: ProjectWorkspace = { ...first, title: 'second', updatedAt: first.updatedAt + 1 };

    storage.scheduleSave(first);
    // Part of the debounce elapses, then a new edit restarts the timer.
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS - 100);
    storage.scheduleSave(second);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS - 100);
    // Neither the elapsed prefix nor the restarted window may have fired yet.
    expect(fakeDb.puts).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(100);
    await flushMicrotasks();
    // Exactly one write went out, carrying the latest snapshot only.
    expect(fakeDb.puts).toHaveLength(1);
    assert(fakeDb.puts[0]);
    expect(fakeDb.puts[0].value.title).toBe('second');
    fakeDb.puts[0].deferred.resolve();
    await flushMicrotasks();
    expect(fakeDb.store.get(first.id)?.title).toBe('second');
  });

  it('flush() persists the pending snapshot immediately and cancels the debounce', async () => {
    const project = makeProject('flushed');
    storage.scheduleSave(project);

    const flushing = storage.flush(project.id);
    await flushMicrotasks();
    // No timer had to elapse: the write is already out.
    expect(fakeDb.puts).toHaveLength(1);
    assert(fakeDb.puts[0]);
    expect(fakeDb.puts[0].value.title).toBe('flushed');
    fakeDb.puts[0].deferred.resolve();
    await flushing;

    // The debounced timer was cancelled — advancing produces no second put.
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    await flushMicrotasks();
    expect(fakeDb.puts).toHaveLength(1);
    // Flushing with nothing pending is a no-op.
    await expect(storage.flush(project.id)).resolves.toBeUndefined();
    expect(fakeDb.puts).toHaveLength(1);
  });

  it('deleteProject cancels the pending debounced save and drops the snapshot', async () => {
    const project = makeProject('doomed');
    storage.scheduleSave(project);

    await storage.deleteProject(project.id);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    await flushMicrotasks();
    expect(fakeDb.puts).toHaveLength(0);
    await expect(storage.getProject(project.id)).resolves.toBeUndefined();
  });

  it('reads back app state it wrote through the store', async () => {
    await storage.setState('lastProjectId', 'project-1');
    await expect(storage.getState<string>('lastProjectId')).resolves.toBe('project-1');

    await storage.setState('lastProjectId', 'project-2');
    await expect(storage.getState<string>('lastProjectId')).resolves.toBe('project-2');
  });

  it('serves the persisted copy when no newer snapshot is pending', async () => {
    const persisted = makeProject('persisted');
    const write = storage.saveProject(persisted);
    await flushMicrotasks();
    assert(fakeDb.puts[0]);
    fakeDb.puts[0].deferred.resolve();
    await write;
    await flushMicrotasks();
    // The successful put retired its pending ticket: the store is consulted.
    await expect(storage.getProject(persisted.id)).resolves.toBe(persisted);
  });

  it('lists persisted projects newest-first', async () => {
    const older = makeProject('older');
    const newer: ProjectWorkspace = {
      ...older,
      id: 'project-2',
      title: 'newer',
      updatedAt: older.updatedAt + 1,
    };
    const firstWrite = storage.saveProject(newer);
    await flushMicrotasks();
    assert(fakeDb.puts[0]);
    fakeDb.puts[0].deferred.resolve();
    await firstWrite;

    const secondWrite = storage.saveProject(older);
    await flushMicrotasks();
    assert(fakeDb.puts[1]);
    fakeDb.puts[1].deferred.resolve();
    await secondWrite;

    await expect(storage.listProjects()).resolves.toEqual([newer, older]);
  });
});

/**
 * jsdom has no IndexedDB, which is exactly the degradation path the service
 * documents for private-browsing modes: every call must resolve instead of
 * throwing, with the in-memory session keeping the data alive.
 */
describe('StorageService without IndexedDB', () => {
  let storage: StorageService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    storage = TestBed.inject(StorageService);
  });

  it('surfaces save failures but keeps the session usable from memory', async () => {
    const project = makeProject('private mode');
    await expect(storage.saveProject(project)).resolves.toBeUndefined();
    expect(storage.saveError()).toBeTruthy();
    // The snapshot survives in memory so the editor keeps working.
    await expect(storage.getProject(project.id)).resolves.toBe(project);
    await expect(storage.listProjects()).resolves.toEqual([project]);
  });

  it('keeps unsaved snapshots visible in listProjects, newest first', async () => {
    const older = makeProject('older');
    const newer: ProjectWorkspace = {
      ...older,
      id: 'project-2',
      title: 'newer',
      updatedAt: older.updatedAt + 1,
    };
    storage.scheduleSave(newer);
    storage.scheduleSave(older);

    await expect(storage.listProjects()).resolves.toEqual([newer, older]);
    // Cancel the debounced write so no stray timer fires after the test.
    await storage.deleteProject(older.id);
    await storage.deleteProject(newer.id);
  });

  it('degrades app-state reads and writes to no-ops', async () => {
    await expect(storage.setState('lastProjectId', 'project-1')).resolves.toBeUndefined();
    await expect(storage.getState<string>('lastProjectId')).resolves.toBeUndefined();
  });

  it('deletes without a durable store without failing', async () => {
    const project = makeProject('gone');
    storage.scheduleSave(project);
    await expect(storage.deleteProject(project.id)).resolves.toBeUndefined();
    await expect(storage.getProject(project.id)).resolves.toBeUndefined();
  });
});
