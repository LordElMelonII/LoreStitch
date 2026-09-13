import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTabChangeEvent, MatTabGroup, MatTabsModule } from '@angular/material/tabs';
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
 * Turns a mouse wheel event into a horizontal scroll of the tab strip, per the
 * M3 scrollable-tabs guidance: when tabs overflow, the strip must also be
 * scrollable on desktop, not only via the pagination chevrons. Returns true
 * when the strip actually moved (so the caller can claim the event).
 */
export function scrollTabStripOnWheel(
  header: { scrollDistance: number } | undefined,
  event: WheelEvent,
): boolean {
  const target = event.target as HTMLElement | null;
  // Only hijack the wheel while it is over the strip itself, never when the
  // pointer is over the tab body (which has its own scrolling).
  if (!header || !target?.closest('.mat-mdc-tab-header')) {
    return false;
  }
  let delta = event.deltaY + event.deltaX;
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    delta *= 40; // Firefox reports the delta in lines rather than pixels.
  }
  if (delta === 0) {
    return false;
  }
  const before = header.scrollDistance;
  header.scrollDistance = before + delta; // Material clamps to the valid range.
  if (header.scrollDistance === before) {
    return false; // Already at an edge, nothing to scroll.
  }
  event.preventDefault();
  return true;
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
  private readonly tabGroup = viewChild(MatTabGroup);

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

  /** Wheel support for the tab strip (see `scrollTabStripOnWheel`). */
  protected onTabStripWheel(event: WheelEvent): void {
    // `_tabHeader` is the group's internal header; it is the only handle for
    // scrolling the strip programmatically before Angular ships wheel support.
    scrollTabStripOnWheel(this.tabGroup()?._tabHeader, event);
  }

  /** Removes a tab without selecting it (the label click selects otherwise). */
  protected closeTab(event: MouseEvent, entryId: number): void {
    event.stopPropagation();
    this.workspace.closeTab(entryId);
  }
}
