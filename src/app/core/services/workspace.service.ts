import { Service, computed, inject, signal } from '@angular/core';
import {
  CharacterBook,
  CharacterBookEntry,
  createEmptyBook,
  createEmptyEntry,
  entryTitle,
} from '../models/lorebook.model';
import type { LintPrefs, ProjectWorkspace } from '../models/project.model';
import { randomUuid } from './sha256';
import { LAST_PROJECT_KEY, StorageService } from './storage.service';
import { VcsService } from './vcs.service';
import { type TokenFootprint, computeTokenFootprint } from './token-estimator';

/**
 * Reactive state hub. Owns the active `ProjectWorkspace` in signals, the open
 * editor tabs, and all entry mutations. Every mutation produces a new project
 * reference (structural sharing via shallow copies) and schedules a debounced
 * IndexedDB save.
 */
@Service()
export class WorkspaceService {
  private readonly storage = inject(StorageService);
  private readonly vcs = inject(VcsService);

  // -------------------------------------------------------------------------
  // Core state
  // -------------------------------------------------------------------------

  readonly activeProject = signal<ProjectWorkspace | null>(null);
  readonly savedProjects = signal<ProjectWorkspace[]>([]);
  readonly loading = signal(false);

  /** Entries of the working tree, in display order. */
  readonly entries = computed<CharacterBookEntry[]>(
    () => this.activeProject()?.activeBook.entries ?? [],
  );

  /** True when the working tree differs from the HEAD snapshot. */
  readonly hasUnsavedChanges = computed<boolean>(() => {
    const project = this.activeProject();
    return project !== null && this.vcs.isDirty(project);
  });

  /** Ids of entries whose working-tree version differs from HEAD. */
  readonly dirtyEntryIds = computed<Set<number>>(() => {
    const project = this.activeProject();
    return project ? this.vcs.dirtyEntryIds(project) : new Set<number>();
  });

  /**
   * Always-active token footprint of the working book: the aggregate content
   * estimate of every enabled + constant entry (the minimum context cost of
   * any generation) against the book's `token_budget`, when set.
   */
  readonly tokenFootprint = computed<TokenFootprint | null>(() => {
    const project = this.activeProject();
    return project ? computeTokenFootprint(project.activeBook) : null;
  });

  /**
   * Human-readable persistence failure for the save-state banner, or null
   * while browser storage is healthy.
   */
  readonly saveError = computed<string | null>(() =>
    this.storage.saveError() !== null
      ? 'Latest changes could not be saved to browser storage. Export your work to avoid data loss.'
      : null,
  );

  // -------------------------------------------------------------------------
  // Editor tabs
  // -------------------------------------------------------------------------

  readonly openTabEntryIds = signal<number[]>([]);
  readonly activeTabId = signal<number | null>(null);

  /** The entry displayed in the editor pane, if its tab is open. */
  readonly activeEntry = computed<CharacterBookEntry | null>(() => {
    const id = this.activeTabId();
    if (id === null) {
      return null;
    }
    return this.entries().find((e) => e.id === id) ?? null;
  });

  constructor() {
    void this.init();
  }

  /** Loads the saved project list and reopens the most recent project. */
  private async init(): Promise<void> {
    this.loading.set(true);
    const projects = await this.storage.listProjects();
    this.savedProjects.set(projects);
    const lastId = await this.storage.getState<string>(LAST_PROJECT_KEY);
    const toOpen = projects.find((p) => p.id === lastId) ?? projects[0];
    if (toOpen) {
      await this.openProject(toOpen.id);
    }
    this.loading.set(false);
  }

  // -------------------------------------------------------------------------
  // Project lifecycle
  // -------------------------------------------------------------------------

  async createProject(
    title: string,
    targetType: ProjectWorkspace['targetType'] = 'standalone_lorebook',
  ): Promise<void> {
    const now = Date.now();
    const project: ProjectWorkspace = {
      id: randomUuid(),
      title: title.trim() || 'Untitled Project',
      createdAt: now,
      updatedAt: now,
      targetType,
      activeBook: createEmptyBook(title.trim() || 'New Lorebook'),
      headCommitId: null,
      commits: [],
    };
    const committed = await this.vcs.createCommit(project, 'Initial commit');
    await this.storage.saveProject(committed);
    await this.setActive(committed);
    await this.refreshProjectList();
  }

  async openProject(id: string): Promise<void> {
    const project = await this.storage.getProject(id);
    if (project) {
      await this.setActive(project);
    }
  }

  async deleteProject(id: string): Promise<void> {
    await this.storage.deleteProject(id);
    if (this.activeProject()?.id === id) {
      this.activeProject.set(null);
      this.openTabEntryIds.set([]);
      this.activeTabId.set(null);
      await this.storage.setState(LAST_PROJECT_KEY, null);
    }
    await this.refreshProjectList();
  }

  async closeProject(): Promise<void> {
    await this.flushPendingSave();
    this.activeProject.set(null);
    this.openTabEntryIds.set([]);
    this.activeTabId.set(null);
    await this.storage.setState(LAST_PROJECT_KEY, null);
  }

  /** Replaces the working book and resets VCS state (used by "new from import"). */
  async startProjectFromBook(title: string, book: CharacterBook): Promise<void> {
    const now = Date.now();
    const project: ProjectWorkspace = {
      id: randomUuid(),
      title,
      createdAt: now,
      updatedAt: now,
      targetType: 'standalone_lorebook',
      activeBook: book,
      headCommitId: null,
      commits: [],
    };
    const committed = await this.vcs.createCommit(
      project,
      `Initial commit: ${book.entries.length} entries`,
    );
    await this.storage.saveProject(committed);
    await this.setActive(committed);
    await this.refreshProjectList();
  }

  /** Re-opens a full workspace from a `.stproj` archive, commits included. */
  async openImportedWorkspace(workspace: ProjectWorkspace): Promise<void> {
    await this.storage.saveProject(workspace);
    await this.setActive(workspace);
    await this.refreshProjectList();
  }

  async renameProject(title: string): Promise<void> {
    this.mutateProject((p) => ({ ...p, title }));
  }

  /**
   * Replaces the active project's linter preferences (plan 03 §3.6.5.4) — the
   * one `lintPrefs` write path, so the mutation/persistence chokepoint stays
   * single. Prefs are workspace metadata: they ride the debounced IndexedDB
   * save and `.stproj` export, never `ProjectCommit.snapshot` and never the
   * book itself.
   */
  updateLintPrefs(prefs: LintPrefs): void {
    this.mutateProject((p) => ({ ...p, lintPrefs: prefs }));
  }

  private async setActive(project: ProjectWorkspace): Promise<void> {
    this.activeProject.set(project);
    await this.storage.setState(LAST_PROJECT_KEY, project.id);
    // Give the editor something to show: first few entries as tabs.
    const tabs = project.activeBook.entries
      .slice(0, 3)
      .map((e) => e.id)
      .filter((id): id is number => typeof id === 'number');
    this.openTabEntryIds.set(tabs);
    this.activeTabId.set(tabs[0] ?? null);
  }

  private async refreshProjectList(): Promise<void> {
    this.savedProjects.set(await this.storage.listProjects());
  }

  // -------------------------------------------------------------------------
  // Entry mutations
  // -------------------------------------------------------------------------

  /** Patches a single entry (by id) in the working tree. */
  updateEntry(entryId: number, patch: Partial<CharacterBookEntry>): void {
    this.mutateProject((p) => {
      const entries = p.activeBook.entries.map((entry) =>
        entry.id === entryId ? { ...entry, ...patch } : entry,
      );
      return this.withBook(p, { ...p.activeBook, entries });
    });
  }

  /**
   * Patches many entries in one project update. `patch` is called per entry so
   * batch transforms (e.g. delimiter re-wrapping) can derive per-entry values.
   */
  updateManyEntries(
    entryIds: number[],
    patch: (entry: CharacterBookEntry) => Partial<CharacterBookEntry>,
  ): void {
    const ids = new Set(entryIds);
    this.mutateProject((p) => {
      const entries = p.activeBook.entries.map((entry) =>
        ids.has(entry.id ?? -1) ? { ...entry, ...patch(entry) } : entry,
      );
      return this.withBook(p, { ...p.activeBook, entries });
    });
  }

  addEntry(): number {
    const project = this.activeProject();
    if (!project) {
      return -1;
    }
    const nextId = this.nextEntryId(project);
    const entry = createEmptyEntry(nextId, project.activeBook.entries.length);
    entry.comment = `New entry ${nextId}`;
    this.mutateProject((p) =>
      this.withBook(p, { ...p.activeBook, entries: [...p.activeBook.entries, entry] }),
    );
    this.openEntry(nextId);
    return nextId;
  }

  duplicateEntry(entryId: number): void {
    const project = this.activeProject();
    if (!project) {
      return;
    }
    const source = project.activeBook.entries.find((e) => e.id === entryId);
    if (!source) {
      return;
    }
    const newId = this.nextEntryId(project);
    const copy = this.entryCopy(source, newId, project.activeBook.entries.length);
    const index = project.activeBook.entries.findIndex((e) => e.id === entryId);
    this.mutateProject((p) => {
      const entries = [...p.activeBook.entries];
      entries.splice(index + 1, 0, copy);
      return this.withBook(p, { ...p.activeBook, entries });
    });
    this.openEntry(newId);
  }

  /**
   * Batch counterpart of `duplicateEntry`: clones every selected entry in
   * one project update, inserting each copy directly after its source.
   */
  duplicateEntries(entryIds: readonly number[]): void {
    const ids = new Set(entryIds);
    this.mutateProject((p) => {
      const entries = [...p.activeBook.entries];
      let nextId = entries.reduce((max, e) => Math.max(max, e.id ?? 0), -1) + 1;
      let duplicated = 0;
      for (const source of p.activeBook.entries) {
        if (source.id === undefined || !ids.has(source.id)) {
          continue;
        }
        // display_index tracks the growing array, exactly one past the end at
        // each insertion.
        const copy = this.entryCopy(source, nextId++, entries.length);
        const at = entries.findIndex((e) => e.id === source.id);
        entries.splice(at + 1, 0, copy);
        duplicated++;
      }
      return duplicated ? this.withBook(p, { ...p.activeBook, entries }) : p;
    });
  }

  /** Deep-cloned "(copy)" of `source` with a fresh id and display index. */
  private entryCopy(
    source: CharacterBookEntry,
    id: number,
    displayIndex: number,
  ): CharacterBookEntry {
    return {
      ...structuredClone(source),
      id,
      comment: `${entryTitle(source)} (copy)`,
      extensions: {
        ...structuredClone(source.extensions ?? {}),
        display_index: displayIndex,
      },
    };
  }

  deleteEntry(entryId: number): void {
    this.mutateProject((p) =>
      this.withBook(p, {
        ...p.activeBook,
        entries: p.activeBook.entries.filter((e) => e.id !== entryId),
      }),
    );
    this.closeTab(entryId);
  }

  /** Batch counterpart of `deleteEntry`: removes many entries in one update. */
  deleteEntries(entryIds: readonly number[]): void {
    const ids = new Set(entryIds);
    this.mutateProject((p) =>
      this.withBook(p, {
        ...p.activeBook,
        entries: p.activeBook.entries.filter((e) => e.id === undefined || !ids.has(e.id)),
      }),
    );
    const remaining = this.openTabEntryIds().filter((id) => !ids.has(id));
    this.openTabEntryIds.set(remaining);
    const active = this.activeTabId();
    if (active !== null && ids.has(active)) {
      this.activeTabId.set(remaining.at(-1) ?? null);
    }
  }

  /** Reorders entries after a drag & drop in the sidebar. */
  moveEntry(previousIndex: number, currentIndex: number): void {
    this.mutateProject((p) => {
      const entries = [...p.activeBook.entries];
      const [moved] = entries.splice(previousIndex, 1);
      if (moved === undefined) {
        // Source index out of range: nothing to move, keep the book as is.
        return p;
      }
      entries.splice(currentIndex, 0, moved);
      // Keep the ST display order in extensions in sync with the visible order.
      return this.withBook(p, {
        ...p.activeBook,
        entries: entries.map((e, i) => ({
          ...e,
          extensions: { ...e.extensions, display_index: i },
        })),
      });
    });
  }

  /** Applies the merge result of the cherry-picker: replaces the whole book. */
  replaceBook(book: CharacterBook): void {
    this.mutateProject((p) => this.withBook(p, book));
  }

  /** Patches book-level settings (e.g. `token_budget`) on the working tree. */
  updateBook(patch: Partial<CharacterBook>): void {
    this.mutateProject((p) => this.withBook(p, { ...p.activeBook, ...patch }));
  }

  private nextEntryId(project: ProjectWorkspace): number {
    return project.activeBook.entries.reduce((max, e) => Math.max(max, e.id ?? 0), -1) + 1;
  }

  // -------------------------------------------------------------------------
  // Tab management
  // -------------------------------------------------------------------------

  openEntry(entryId: number): void {
    if (!this.entries().some((e) => e.id === entryId)) {
      return;
    }
    this.openTabEntryIds.update((tabs) => (tabs.includes(entryId) ? tabs : [...tabs, entryId]));
    this.activeTabId.set(entryId);
  }

  closeTab(entryId: number): void {
    this.openTabEntryIds.update((tabs) => tabs.filter((id) => id !== entryId));
    if (this.activeTabId() === entryId) {
      const remaining = this.openTabEntryIds();
      this.activeTabId.set(remaining.at(-1) ?? null);
    }
  }

  // -------------------------------------------------------------------------
  // Version control passthrough
  // -------------------------------------------------------------------------

  async commit(message: string): Promise<boolean> {
    const project = this.activeProject();
    if (!project) {
      return false;
    }
    const committed = await this.vcs.createCommit(project, message);
    this.activeProject.set(committed);
    await this.storage.saveProject(committed);
    await this.refreshProjectList();
    return true;
  }

  async rollbackTo(commitId: string): Promise<boolean> {
    const project = this.activeProject();
    if (!project) {
      return false;
    }
    const { project: rolled } = await this.vcs.rollbackToCommit(project, commitId);
    this.activeProject.set(rolled);
    await this.storage.saveProject(rolled);
    await this.refreshProjectList();
    return true;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /** Shallow-immutable project update plus debounced persistence. */
  private mutateProject(mutate: (project: ProjectWorkspace) => ProjectWorkspace): void {
    const current = this.activeProject();
    if (!current) {
      return;
    }
    const next = mutate(current);
    this.activeProject.set(next);
    this.storage.scheduleSave(next);
  }

  private withBook(project: ProjectWorkspace, book: CharacterBook): ProjectWorkspace {
    return { ...project, activeBook: book, updatedAt: Date.now() };
  }

  /** Persists any pending debounced write immediately (used before teardown). */
  async flushPendingSave(): Promise<void> {
    const project = this.activeProject();
    if (project) {
      await this.storage.flush(project.id);
    }
  }
}
