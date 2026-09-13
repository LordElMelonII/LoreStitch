import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { entryTitle, entryTriggerState, WiTriggerState } from '../../core/models/lorebook.model';
import { WorkspaceService } from '../../core/services/workspace.service';

interface EntryListItem {
  id: number;
  title: string;
  keys: string[];
  enabled: boolean;
  state: WiTriggerState;
  dirty: boolean;
  content: string;
}

/** Sidebar listing every entry; supports filtering, drag reorder and actions. */
@Component({
  selector: 'app-entry-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DragDropModule,
    ScrollingModule,
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

  protected readonly filter = signal('');

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

  protected onFilterInput(event: Event): void {
    this.filter.set((event.target as HTMLInputElement).value);
  }

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
