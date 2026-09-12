import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTabChangeEvent, MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CharacterBookEntry } from '../../core/models/lorebook.model';
import { WorkspaceService } from '../../core/services/workspace.service';
import { EntryFields } from './entry-fields';

interface TabItem {
  id: number;
  title: string;
  dirty: boolean;
}

/**
 * Central tabbed editor built on `mat-tab-group`. Every open entry is a tab
 * with its own `EntryFields` instance; the label template carries the dirty
 * indicator and a close button.
 */
@Component({
  selector: 'app-entry-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatIconModule, MatTabsModule, MatTooltipModule, EntryFields],
  templateUrl: './entry-editor.html',
  styleUrl: './entry-editor.scss',
})
export class EntryEditor {
  protected readonly workspace = inject(WorkspaceService);

  protected readonly tabs = computed<TabItem[]>(() => {
    const dirty = this.workspace.dirtyEntryIds();
    const byId = new Map(this.workspace.entries().map((e) => [e.id, e]));
    return this.workspace.openTabEntryIds().flatMap((id) => {
      const entry = byId.get(id);
      return entry ? [{ id, title: this.tabTitle(entry), dirty: dirty.has(id) }] : [];
    });
  });

  protected readonly activeIndex = computed(() =>
    this.tabs().findIndex((tab) => tab.id === this.workspace.activeTabId()),
  );

  protected readonly entryFor = computed(() => {
    const byId = new Map<number, CharacterBookEntry>(
      this.workspace.entries().flatMap((e) => (e.id === undefined ? [] : [[e.id, e] as const])),
    );
    return (id: number) => byId.get(id);
  });

  constructor() {
    // Self-healing selection: if the active tab id is gone (e.g. its entry was
    // deleted), fall back to the first open tab so the pane never blanks out.
    effect(() => {
      const tabs = this.tabs();
      const id = this.workspace.activeTabId();
      if (tabs.length && !tabs.some((tab) => tab.id === id)) {
        this.workspace.activeTabId.set(tabs[0].id);
      }
    });
  }

  protected tabTitle(entry: CharacterBookEntry): string {
    const title = entry.comment?.trim() || entry.name?.trim();
    return title || (entry.keys.length ? entry.keys.join(', ') : `Entry ${entry.id}`);
  }

  protected onTabChange(event: MatTabChangeEvent): void {
    const id = this.tabs()[event.index]?.id ?? null;
    if (id !== this.workspace.activeTabId()) {
      this.workspace.activeTabId.set(id);
    }
  }

  /** Removes a tab without selecting it (the label click selects otherwise). */
  protected closeTab(event: MouseEvent, entryId: number): void {
    event.stopPropagation();
    this.workspace.closeTab(entryId);
  }
}
