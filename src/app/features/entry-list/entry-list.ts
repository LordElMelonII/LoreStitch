import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { CdkVirtualScrollViewport, ScrollingModule } from '@angular/cdk/scrolling';
import { FormField, form } from '@angular/forms/signals';
import { firstValueFrom } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { entryTags, entryTitle, entryTriggerState } from '../../core/models/lorebook.model';
import { estimateEntryTokens, formatTokenCount } from '../../core/services/token-estimator';
import { WorkspaceService } from '../../core/services/workspace.service';
import { ProjectActionsService } from '../shell/project-actions.service';
import { type EntryListItem } from './entry-list.model';

/** Form model of the sidebar filter box. */
interface EntryFilterModel {
  query: string;
}

/**
 * Sidebar listing every entry; supports filtering (text + tag), batch
 * selection with a bulk-actions bar, drag reorder and per-row actions.
 */
@Component({
  selector: 'app-entry-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DragDropModule,
    ScrollingModule,
    FormField,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatMenuModule,
    MatTooltipModule,
  ],
  templateUrl: './entry-list.html',
  styleUrl: './entry-list.scss',
})
export class EntryList {
  protected readonly workspace = inject(WorkspaceService);
  protected readonly actions = inject(ProjectActionsService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  private readonly viewport = viewChild.required(CdkVirtualScrollViewport);

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      // Both observers are standard in every browser; skip exotic environments
      // (e.g. bare jsdom) rather than crash.
      if (typeof ResizeObserver === 'undefined' || typeof IntersectionObserver === 'undefined') {
        return;
      }
      const viewport = this.viewport();
      const element = viewport.elementRef.nativeElement;
      // The CDK scroller measures its box once and only re-measures on window
      // resize. On mobile this list is created while the entries drawer is
      // still off-canvas, so that first measurement is wrong and would leave
      // the viewport under-filled forever. Re-check on real box resizes
      // (URL-bar dvh shifts) and whenever the drawer becomes visible; both
      // no-op once the scroller agrees with the live layout.
      const resizeObserver = new ResizeObserver(() => viewport.checkViewportSize());
      resizeObserver.observe(element);
      const intersectionObserver = new IntersectionObserver(() => viewport.checkViewportSize());
      intersectionObserver.observe(element);
      destroyRef.onDestroy(() => {
        resizeObserver.disconnect();
        intersectionObserver.disconnect();
      });
    });

    // Batch selection and tag filters are scoped to one project: opening
    // another project, importing a book or closing the project must drop
    // them, or the stale ids would drive silent no-op batch actions (and
    // ghosts in the batch bar). Only the project identity is tracked —
    // ordinary edits recreate the project object but keep the id.
    let selectedProjectId: string | null = null;
    effect(() => {
      const projectId = this.workspace.activeProject()?.id ?? null;
      if (projectId !== selectedProjectId) {
        untracked(() => {
          this.selection.set(new Set());
          this.tagFilter.set(new Set());
        });
      }
      selectedProjectId = projectId;
    });

    // Rollbacks keep the project id but can replace the whole entry list —
    // prune any selected id that no longer exists so batch actions never
    // run as silent no-ops against ghosts. (The filter only shrinks the
    // selection; an unchanged selection is returned by reference.)
    effect(() => {
      const known = new Set(
        this.workspace.entries().flatMap((e) => (e.id === undefined ? [] : [e.id])),
      );
      untracked(() =>
        this.selection.update((current) => {
          const next = new Set([...current].filter((id) => known.has(id)));
          return next.size === current.size ? current : next;
        }),
      );
    });

    // Appended entries (from the sidebar or the top bar "+") land at the
    // bottom of the list: bring the new row into view. A count change of
    // exactly +1 with a new highest id distinguishes an append from a book
    // import (whole-book replacement) or a duplicate (inserted mid-list).
    let previous: { count: number; lastId: number | null } | null = null;
    effect(() => {
      const entries = this.workspace.entries();
      const count = entries.length;
      const lastId = entries.at(-1)?.id ?? null;
      const appended =
        previous !== null &&
        count === previous.count + 1 &&
        lastId !== null &&
        (previous.lastId === null || lastId > previous.lastId);
      previous = { count, lastId };
      if (appended && lastId !== null) {
        untracked(() => {
          // Fresh entries have no keys or content: if an active filter would
          // hide the new row, clear the filter so it is actually visible.
          if (!this.filtered().some((item) => item.id === lastId)) {
            this.filterModel.set({ query: '' });
            this.tagFilter.set(new Set());
          }
          this.scrollToEntry(lastId);
        });
      }
    });
  }

  private readonly filterModel = signal<EntryFilterModel>({ query: '' });
  protected readonly filterForm = form(this.filterModel);

  /** Current filter text (single source: the form model). */
  protected readonly filter = computed(() => this.filterModel().query);

  /** Clears the filter box. */
  protected clearFilter(): void {
    this.filterModel.set({ query: '' });
  }

  // -------------------------------------------------------------------------
  // Batch selection & tag filter
  // -------------------------------------------------------------------------

  /** Selected entry ids for the batch suite. */
  protected readonly selection = signal<ReadonlySet<number>>(new Set());

  /** Tags the filter isolates on: an entry must carry all of them. */
  protected readonly tagFilter = signal<ReadonlySet<string>>(new Set());

  protected readonly items = computed<EntryListItem[]>(() => {
    const dirty = this.workspace.dirtyEntryIds();
    return this.workspace.entries().map((entry) => ({
      id: entry.id ?? -1,
      title: entryTitle(entry),
      keys: entry.keys ?? [],
      enabled: entry.enabled,
      state: entryTriggerState(entry),
      dirty: entry.id !== undefined && dirty.has(entry.id),
      content: entry.content ?? '',
      tokens: estimateEntryTokens(entry),
      tags: entryTags(entry),
    }));
  });

  /** All tags in the book, alphabetically (drives the filter chips). */
  protected readonly allTags = computed<string[]>(() => {
    const tags = new Set<string>();
    for (const item of this.items()) {
      for (const tag of item.tags) {
        tags.add(tag);
      }
    }
    return [...tags].sort((a, b) => a.localeCompare(b));
  });

  protected readonly filtered = computed<EntryListItem[]>(() => {
    const query = this.filter().trim().toLowerCase();
    const requiredTags = this.tagFilter();
    const all = this.items();
    const byTags = requiredTags.size
      ? all.filter((item) => {
          const owned = new Set(item.tags);
          for (const tag of requiredTags) {
            if (!owned.has(tag)) {
              return false;
            }
          }
          return true;
        })
      : all;
    if (!query) {
      return byTags;
    }
    return byTags.filter(
      (item) =>
        item.title.toLowerCase().includes(query) ||
        item.keys.some((k) => k.toLowerCase().includes(query)) ||
        item.tags.some((tag) => tag.toLowerCase().includes(query)) ||
        item.content.toLowerCase().includes(query),
    );
  });

  protected readonly activeId = computed(() => this.workspace.activeTabId());

  protected readonly selectionCount = computed(() => this.selection().size);

  protected readonly allFilteredSelected = computed(() => {
    const view = this.filtered();
    const selection = this.selection();
    return view.length > 0 && view.every((item) => selection.has(item.id));
  });

  protected readonly someFilteredSelected = computed(() => {
    const view = this.filtered();
    const selection = this.selection();
    return view.some((item) => selection.has(item.id)) && !this.allFilteredSelected();
  });

  protected toggleSelectAll(checked: boolean): void {
    if (checked) {
      const selection = new Set(this.selection());
      for (const item of this.filtered()) {
        selection.add(item.id);
      }
      this.selection.set(selection);
    } else {
      const selectedShown = new Set(this.filtered().map((item) => item.id));
      this.selection.update((current) => {
        const next = new Set<number>();
        for (const id of current) {
          if (!selectedShown.has(id)) {
            next.add(id);
          }
        }
        return next;
      });
    }
  }

  protected toggleRow(item: EntryListItem, checked: boolean): void {
    this.selection.update((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(item.id);
      } else {
        next.delete(item.id);
      }
      return next;
    });
  }

  protected clearSelection(): void {
    this.selection.set(new Set());
  }

  protected toggleTagFilter(tag: string): void {
    this.tagFilter.update((current) => {
      const next = new Set(current);
      if (next.has(tag)) {
        next.delete(tag);
      } else {
        next.add(tag);
      }
      return next;
    });
  }

  protected isTagActive(tag: string): boolean {
    return this.tagFilter().has(tag);
  }

  // -------------------------------------------------------------------------
  // Row & batch actions
  // -------------------------------------------------------------------------

  protected open(item: EntryListItem): void {
    this.workspace.openEntry(item.id);
  }

  protected add(): void {
    this.workspace.addEntry();
    // Revealing (filter clearing + scroll to the appended row) is handled by
    // the append-tracking effect above, for both add buttons.
  }

  /** Smoothly brings an entry's row into the virtual viewport. */
  private scrollToEntry(entryId: number): void {
    // Let the virtual scroller register the appended row before scrolling.
    setTimeout(() => {
      const index = this.filtered().findIndex((item) => item.id === entryId);
      if (index >= 0) {
        this.viewport().scrollToIndex(index, 'smooth');
      }
    });
  }

  protected duplicate(item: EntryListItem): void {
    this.workspace.duplicateEntry(item.id);
  }

  protected duplicateSelection(): void {
    const ids = [...this.selection()];
    if (!ids.length) {
      return;
    }
    this.workspace.duplicateEntries(ids);
    this.snackBar.open(`Duplicated ${ids.length} entr${ids.length === 1 ? 'y' : 'ies'}.`, 'OK', {
      duration: 3000,
    });
  }

  protected delete(item: EntryListItem): void {
    this.workspace.deleteEntry(item.id);
    this.selection.update((current) => {
      if (!current.has(item.id)) {
        return current;
      }
      const next = new Set(current);
      next.delete(item.id);
      return next;
    });
  }

  protected setSelectionEnabled(enabled: boolean): void {
    const ids = [...this.selection()];
    this.workspace.updateManyEntries(ids, () => ({ enabled }));
    this.snackBar.open(
      `${enabled ? 'Enabled' : 'Disabled'} ${ids.length} entr${ids.length === 1 ? 'y' : 'ies'}.`,
      'OK',
      { duration: 3000 },
    );
  }

  protected async deleteSelection(): Promise<void> {
    const ids = [...this.selection()];
    if (!ids.length) {
      return;
    }
    // Lazy-loaded: keeps the confirm dialog out of the initial bundle.
    const { ConfirmDialog } = await import('../../shared/components/confirm-dialog/confirm-dialog');
    const confirmed = await firstValueFrom(
      this.dialog
        .open(ConfirmDialog, {
          panelClass: 'app-compact-fullscreen-dialog',
          data: {
            title: 'Delete entries',
            message: `Delete ${ids.length} selected entr${ids.length === 1 ? 'y' : 'ies'}? This can be recovered by rolling back in history.`,
            confirmLabel: 'Delete',
            danger: true,
          },
        })
        .afterClosed(),
    );
    if (!confirmed) {
      return;
    }
    this.workspace.deleteEntries(ids);
    this.clearSelection();
    this.snackBar.open(`Deleted ${ids.length} entr${ids.length === 1 ? 'y' : 'ies'}.`, 'OK', {
      duration: 3000,
    });
  }

  protected async openBatchOperations(): Promise<void> {
    const ids = [...this.selection()];
    if (!ids.length) {
      return;
    }
    // Lazy-loaded: keeps the batch dialog out of the initial bundle.
    const { BatchOperationsDialog } = await import('./batch-operations-dialog');
    const applied = await firstValueFrom(
      this.dialog
        .open(BatchOperationsDialog, {
          width: '100%',
          maxWidth: 'min(96vw, 560px)',
          panelClass: 'app-compact-fullscreen-dialog',
          data: { entryIds: ids },
        })
        .afterClosed(),
    );
    if (applied) {
      this.clearSelection();
    }
  }

  protected exportSelection(): void {
    void this.actions.exportSelectedEntries([...this.selection()]);
  }

  protected formatTokens(tokens: number): string {
    return formatTokenCount(tokens);
  }

  protected drop(previousIndex: number, currentIndex: number): void {
    const view = this.filtered();
    if (view.length === this.items().length) {
      this.workspace.moveEntry(previousIndex, currentIndex);
    } else {
      // Translate viewport indexes back to working-tree indexes.
      const all = this.items();
      const moved = view[previousIndex];
      const target = view[currentIndex];
      if (!moved || !target) {
        return;
      }
      const from = all.findIndex((i) => i.id === moved.id);
      const to = all.findIndex((i) => i.id === target.id);
      if (from >= 0 && to >= 0) {
        this.workspace.moveEntry(from, to);
      }
    }
  }
}
