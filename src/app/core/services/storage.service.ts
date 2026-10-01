import { Service, inject, signal } from '@angular/core';
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { ProjectWorkspace } from '../models/project.model';
import { SessionLockService } from './session-lock.service';

interface LoreStitchDb extends DBSchema {
  projects: {
    key: string;
    value: ProjectWorkspace;
    indexes: { 'by-updatedAt': number };
  };
  appState: {
    key: string;
    value: unknown;
  };
}

const DB_NAME = 'lorestitch';
const DB_VERSION = 1;
export const SAVE_DEBOUNCE_MS = 400;

/** Key under `appState` remembering the most recently opened project. */
export const LAST_PROJECT_KEY = 'lastProjectId';

/** A debounced save ticket: the timer plus the edit-rights epoch it was scheduled under. */
interface PendingSaveTicket {
  timer: ReturnType<typeof setTimeout>;
  epoch: number;
}

/**
 * Offline persistence layer. Projects live in IndexedDB via `idb`; edits are
 * flushed with a short debounce so rapid keystrokes don't thrash the store.
 * Debounced writes carry a session-lock epoch (task 11 §3.2): the gate is
 * re-run when the timer FIRES, so a save scheduled while `held` can never
 * land after `lost` — and a snapshot tainted by a lost lock is retired from
 * memory rather than served, keeping `getProject` on storage truth for the
 * shell's reload-on-acquire.
 */
@Service()
export class StorageService {
  private readonly sessionLock = inject(SessionLockService);
  private readonly db: Promise<IDBPDatabase<LoreStitchDb>>;
  private readonly pendingSaves = new Map<string, PendingSaveTicket>();
  private readonly pendingProjects = new Map<string, ProjectWorkspace>();
  private readonly lastSaveError = signal<unknown>(null);

  /** The most recent persistence failure, or null after a successful write. */
  readonly saveError = this.lastSaveError.asReadonly();

  constructor() {
    this.db = this.open();
    // jsdom (tests) and some private-browsing modes reject the open right
    // away; every consumer handles the rejection through its own try/catch,
    // but until the first reader awaits, Node would report an unhandled
    // rejection. Mark it handled up front — consumers still see the error.
    this.db.catch(() => undefined);
  }

  private async open(): Promise<IDBPDatabase<LoreStitchDb>> {
    return openDB<LoreStitchDb>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('projects')) {
          const projects = db.createObjectStore('projects', { keyPath: 'id' });
          projects.createIndex('by-updatedAt', 'updatedAt');
        }
        if (!db.objectStoreNames.contains('appState')) {
          db.createObjectStore('appState');
        }
      },
    });
  }

  /** Lists all saved projects, most recently updated first. */
  async listProjects(): Promise<ProjectWorkspace[]> {
    try {
      const db = await this.db;
      const all = await db.getAllFromIndex('projects', 'by-updatedAt');
      return all.reverse();
    } catch {
      // Private-browsing modes can block IndexedDB entirely; degrade to an
      // in-memory session instead of failing to boot.
      return [...this.pendingProjects.values()].sort((a, b) => b.updatedAt - a.updatedAt);
    }
  }

  async getProject(id: string): Promise<ProjectWorkspace | undefined> {
    try {
      const db = await this.db;
      // A debounced save may hold a snapshot newer than the persisted copy —
      // but only while the snapshot is still untainted: this tab may persist
      // the project and its edit-rights epoch has not flipped since the save
      // was scheduled (plan 11 §3.3). A tainted snapshot is retired instead
      // of served, so the reload-on-acquire re-derives the tree and forms
      // from the holder's flushed storage state ("gated keystrokes heal").
      if (this.pendingUsable(id)) {
        return this.pendingProjects.get(id);
      }
      this.pendingProjects.delete(id);
      return await db.get('projects', id);
    } catch {
      return this.pendingProjects.get(id);
    }
  }

  async saveProject(project: ProjectWorkspace): Promise<void> {
    this.pendingProjects.set(project.id, project);
    try {
      const db = await this.db;
      await db.put('projects', project);
      this.lastSaveError.set(null);
      // IndexedDB serializes overlapping transactions on the same store in
      // creation order, so a newer put always lands last. Retire the ticket
      // only if no newer snapshot replaced it while this put was in flight.
      if (this.pendingProjects.get(project.id) === project) {
        this.pendingProjects.delete(project.id);
      }
    } catch (error) {
      this.lastSaveError.set(error);
      // Keep the in-memory copy so the session stays usable.
    }
  }

  async deleteProject(id: string): Promise<void> {
    const ticket = this.pendingSaves.get(id);
    if (ticket !== undefined) {
      clearTimeout(ticket.timer);
      this.pendingSaves.delete(id);
    }
    this.pendingProjects.delete(id);
    try {
      const db = await this.db;
      await db.delete('projects', id);
    } catch {
      // Ignore - nothing durable to remove.
    }
  }

  /**
   * Schedules a project save, debounced per project id (~400ms). The latest
   * snapshot always wins. The ticket pins the session-lock epoch it was
   * scheduled under; the fire-time gate (plan 11 §3.2) re-checks both the
   * epoch and `mayPersist` when the timer FIRES — not when scheduled — so a
   * save scheduled while `held`/`relinquishing` can never land after
   * `lost`/`blocked`, even if the tab re-acquired the lock in between.
   */
  scheduleSave(project: ProjectWorkspace): void {
    const existing = this.pendingSaves.get(project.id);
    if (existing !== undefined) {
      clearTimeout(existing.timer);
    }
    this.pendingProjects.set(project.id, project);
    const epoch = this.sessionLock.writeEpoch();
    this.pendingSaves.set(project.id, {
      epoch,
      timer: setTimeout(() => {
        this.pendingSaves.delete(project.id);
        const latest = this.pendingProjects.get(project.id);
        if (latest === undefined) {
          return;
        }
        if (this.sessionLock.writeEpoch() !== epoch || !this.sessionLock.mayPersist(latest.id)) {
          // Gated at fire time: the snapshot is confined to memory and
          // retired, so `getProject` serves storage truth instead of this
          // tab's stale pre-block copy (plan 11 §7.3 "gated keystrokes heal").
          this.pendingProjects.delete(latest.id);
          return;
        }
        void this.saveProject(latest);
      }, SAVE_DEBOUNCE_MS),
    });
  }

  /** Immediately flushes any debounced save for the given project. */
  async flush(projectId: string): Promise<void> {
    const ticket = this.pendingSaves.get(projectId);
    if (ticket !== undefined) {
      clearTimeout(ticket.timer);
      this.pendingSaves.delete(projectId);
      const latest = this.pendingProjects.get(projectId);
      if (latest) {
        await this.saveProject(latest);
      }
    }
  }

  /**
   * True when a pending snapshot for `id` may still be served and landed
   * (plan 11 §3.2): this tab may persist the project and, when a debounced
   * ticket exists, its edit-rights epoch is still current. `flush` and
   * `saveProject` deliberately bypass this — the relinquishing holder must
   * write its pending save through them before releasing the lock.
   */
  private pendingUsable(id: string): boolean {
    if (!this.pendingProjects.has(id)) {
      return false;
    }
    if (!this.sessionLock.mayPersist(id)) {
      return false;
    }
    const ticket = this.pendingSaves.get(id);
    return ticket === undefined || ticket.epoch === this.sessionLock.writeEpoch();
  }

  async getState<T>(key: string): Promise<T | undefined> {
    try {
      const db = await this.db;
      return (await db.get('appState', key)) as T | undefined;
    } catch {
      return undefined;
    }
  }

  async setState(key: string, value: unknown): Promise<void> {
    try {
      const db = await this.db;
      await db.put('appState', value, key);
    } catch {
      // Non-critical metadata; ignore failures.
    }
  }
}
