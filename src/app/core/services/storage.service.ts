import { Service, signal } from '@angular/core';
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { ProjectWorkspace } from '../models/lorebook.model';

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

export const DB_NAME = 'lorestitch';
export const DB_VERSION = 1;
export const SAVE_DEBOUNCE_MS = 400;

/** Key under `appState` remembering the most recently opened project. */
export const LAST_PROJECT_KEY = 'lastProjectId';

/**
 * Offline persistence layer. Projects live in IndexedDB via `idb`; edits are
 * flushed with a short debounce so rapid keystrokes don't thrash the store.
 */
@Service()
export class StorageService {
  private readonly db: Promise<IDBPDatabase<LoreStitchDb>>;
  private readonly pendingSaves = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly pendingProjects = new Map<string, ProjectWorkspace>();
  private readonly lastSaveError = signal<unknown>(null);

  /** The most recent persistence failure, or null after a successful write. */
  readonly saveError = this.lastSaveError.asReadonly();

  constructor() {
    this.db = this.open();
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
      // A debounced save may hold a snapshot newer than the persisted copy.
      return this.pendingProjects.get(id) ?? (await db.get('projects', id));
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
    const timer = this.pendingSaves.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
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
   * snapshot always wins.
   */
  scheduleSave(project: ProjectWorkspace): void {
    const existing = this.pendingSaves.get(project.id);
    if (existing !== undefined) {
      clearTimeout(existing);
    }
    this.pendingProjects.set(project.id, project);
    this.pendingSaves.set(
      project.id,
      setTimeout(() => {
        this.pendingSaves.delete(project.id);
        const latest = this.pendingProjects.get(project.id);
        if (latest) {
          void this.saveProject(latest);
        }
      }, SAVE_DEBOUNCE_MS),
    );
  }

  /** Immediately flushes any debounced save for the given project. */
  async flush(projectId: string): Promise<void> {
    const timer = this.pendingSaves.get(projectId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.pendingSaves.delete(projectId);
      const latest = this.pendingProjects.get(projectId);
      if (latest) {
        await this.saveProject(latest);
      }
    }
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
