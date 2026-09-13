import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
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
import { EntryContentField } from './entry-content-field/entry-content-field';
import { EntryName } from './entry-name/entry-name';
import { EntryOptionsAccordion } from './entry-options-accordion/entry-options-accordion';

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

/** Minimum pointer travel before a gesture counts as a drag instead of a tap. */
export const TAB_STRIP_DRAG_SLOP_PX = 8;

/**
 * Touch/pen counterpart of `scrollTabStripOnWheel`: tracks a horizontal swipe
 * that starts on the tab strip and drags the strip with the finger. A gesture
 * that travels past the slop threshold marks the following click for
 * suppression, so swiping never selects the tab the swipe started on.
 */
export class TabStripDragScroller {
  private pointerId: number | null = null;
  private startX = 0;
  private startDistance = 0;
  private moved = false;

  /**
   * Begins tracking a potential drag. Only primary touch/pen pointers that
   * start on the strip qualify; mouse users scroll with the wheel and chevrons.
   */
  onPointerDown(header: { scrollDistance: number } | undefined, event: PointerEvent): void {
    this.pointerId = null;
    this.moved = false;
    if (!header || !event.isPrimary || event.pointerType === 'mouse') {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (!target?.closest('.mat-mdc-tab-header')) {
      return;
    }
    this.pointerId = event.pointerId;
    this.startX = event.clientX;
    this.startDistance = header.scrollDistance;
    // Keep receiving moves even when the finger drifts off the strip. Real
    // pointers always support capture; synthetic events (tests) may not.
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      // Dragging still works through ordinary event bubbling.
    }
  }

  /** Drags the strip opposite to the pointer travel; true when it scrolled. */
  onPointerMove(header: { scrollDistance: number } | undefined, event: PointerEvent): boolean {
    if (this.pointerId === null || event.pointerId !== this.pointerId || !header) {
      return false;
    }
    const deltaX = event.clientX - this.startX;
    if (!this.moved && Math.abs(deltaX) < TAB_STRIP_DRAG_SLOP_PX) {
      return false;
    }
    this.moved = true;
    const before = header.scrollDistance;
    header.scrollDistance = this.startDistance - deltaX;
    return header.scrollDistance !== before;
  }

  /** Ends tracking (pointerup or pointercancel). */
  onPointerUp(event: PointerEvent): void {
    if (event.pointerId !== this.pointerId) {
      return;
    }
    this.pointerId = null;
    // The browser dispatches the click right after pointerup; clear the flag
    // afterwards so a later keyboard-activated tab is never suppressed.
    if (this.moved) {
      setTimeout(() => (this.moved = false));
    }
  }

  /** Returns (and clears) whether the current click follows a drag gesture. */
  consumeClickSuppression(): boolean {
    const suppress = this.moved;
    this.moved = false;
    return suppress;
  }
}

/**
 * Central tabbed editor built on `mat-tab-group`. Every open entry is a tab
 * hosting the writing surface (`EntryName`, `EntryContentField`) above the
 * `EntryOptionsAccordion`, which collapses placement, keys and advanced
 * options behind the bottom control strip; the label template carries the
 * dirty indicator and a close button.
 */
@Component({
  selector: 'app-entry-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatTabsModule,
    MatTooltipModule,
    EntryContentField,
    EntryName,
    EntryOptionsAccordion,
  ],
  templateUrl: './entry-editor.html',
  styleUrl: './entry-editor.scss',
})
export class EntryEditor {
  protected readonly workspace = inject(WorkspaceService);
  private readonly tabGroup = viewChild(MatTabGroup);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly drag = new TabStripDragScroller();

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

    // Swallow the synthetic click that trails a drag-scroll of the strip so a
    // swipe never selects the tab the finger started on. Capture phase is
    // required: the tab's own click handler fires before any bubble listener.
    const hostElement = this.host.nativeElement;
    const suppressDragClick = (event: Event): void => {
      if (this.drag.consumeClickSuppression()) {
        event.stopPropagation();
        event.preventDefault();
      }
    };
    hostElement.addEventListener('click', suppressDragClick, true);
    inject(DestroyRef).onDestroy(() =>
      hostElement.removeEventListener('click', suppressDragClick, true),
    );
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

  /** Touch/pen swipe support for the strip (see `TabStripDragScroller`). */
  protected onStripPointerDown(event: PointerEvent): void {
    this.drag.onPointerDown(this.tabGroup()?._tabHeader, event);
  }

  protected onStripPointerMove(event: PointerEvent): void {
    if (this.drag.onPointerMove(this.tabGroup()?._tabHeader, event)) {
      // Drop the programmatic scroll easing so the tabs track the finger 1:1.
      this.host.nativeElement.classList.add('strip-dragging');
    }
  }

  protected onStripPointerEnd(event: PointerEvent): void {
    this.drag.onPointerUp(event);
    this.host.nativeElement.classList.remove('strip-dragging');
  }

  /** Removes a tab without selecting it (the label click selects otherwise). */
  protected closeTab(event: MouseEvent, entryId: number): void {
    event.stopPropagation();
    this.workspace.closeTab(entryId);
  }
}
