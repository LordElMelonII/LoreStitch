import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { CdkVirtualScrollViewport, ScrollingModule } from '@angular/cdk/scrolling';
import { FormField, form } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { entryTitle, entryTriggerState } from '../../core/models/lorebook.model';
import { WorkspaceService } from '../../core/services/workspace.service';
import { type EntryListItem } from './entry-list.model';

/** Form model of the sidebar filter box. */
interface EntryFilterModel {
  query: string;
}

/** Sidebar listing every entry; supports filtering, drag reorder and actions. */
@Component({
  selector: 'app-entry-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DragDropModule,
    ScrollingModule,
    FormField,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatTooltipModule,
  ],
  templateUrl: './entry-list.html',
  styleUrl: './entry-list.scss',
})
export class EntryList {
  protected readonly workspace = inject(WorkspaceService);

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
  }

  private readonly filterModel = signal<EntryFilterModel>({ query: '' });
  protected readonly filterForm = form(this.filterModel);

  /** Current filter text (single source: the form model). */
  protected readonly filter = computed(() => this.filterModel().query);

  /** Clears the filter box. */
  protected clearFilter(): void {
    this.filterModel.set({ query: '' });
  }

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
    }));
  });

  protected readonly filtered = computed<EntryListItem[]>(() => {
    const query = this.filter().trim().toLowerCase();
    const all = this.items();
    if (!query) {
      return all;
    }
    return all.filter(
      (item) =>
        item.title.toLowerCase().includes(query) ||
        item.keys.some((k) => k.toLowerCase().includes(query)) ||
        item.content.toLowerCase().includes(query),
    );
  });

  protected readonly activeId = computed(() => this.workspace.activeTabId());

  protected open(item: EntryListItem): void {
    this.workspace.openEntry(item.id);
  }

  protected add(): void {
    this.workspace.addEntry();
  }

  protected duplicate(item: EntryListItem): void {
    this.workspace.duplicateEntry(item.id);
  }

  protected delete(item: EntryListItem): void {
    this.workspace.deleteEntry(item.id);
  }

  protected drop(previousIndex: number, currentIndex: number): void {
    const view = this.filtered();
    if (view.length === this.items().length) {
      this.workspace.moveEntry(previousIndex, currentIndex);
    } else {
      // Translate viewport indexes back to working-tree indexes.
      const all = this.items();
      const movedId = view[previousIndex].id;
      const targetId = view[currentIndex].id;
      const from = all.findIndex((i) => i.id === movedId);
      const to = all.findIndex((i) => i.id === targetId);
      if (from >= 0 && to >= 0) {
        this.workspace.moveEntry(from, to);
      }
    }
  }
}
