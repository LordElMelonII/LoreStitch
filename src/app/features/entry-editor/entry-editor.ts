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
import { SessionLockService } from '../../core/services/session-lock.service';
import {
  TAB_STRIP_DRAG_SLOP_PX,
  TAB_STRIP_FLING_DECAY_MS,
  TAB_STRIP_FLING_MIN_START_PX_PER_MS,
  TAB_STRIP_FLING_STOP_PX_PER_MS,
  TAB_STRIP_FLING_VELOCITY_WINDOW_MS,
} from './entry-editor.constants';
import { EntryLookup, ScrollableTabHeader, type TabItem } from './entry-editor.model';
import { EntryContentField } from './entry-content-field/entry-content-field';
import { EntryName } from './entry-name/entry-name';
import { EntryOptionsAccordion } from './entry-options-accordion/entry-options-accordion';

/**
 * Turns a mouse wheel event into a horizontal scroll of the tab strip, per the
 * M3 scrollable-tabs guidance: when tabs overflow, the strip must also be
 * scrollable on desktop, not only via the pagination chevrons. Returns true
 * when the strip actually moved (so the caller can claim the event).
 */
export function scrollTabStripOnWheel(
  header: ScrollableTabHeader | undefined,
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
 * Frame scheduler the tab-strip release fling animates on — the
 * requestAnimationFrame pair, structured so tests can pump frames manually.
 */
export interface TabStripFrameScheduler {
  requestFrame(callback: (time: number) => void): number;
  cancelFrame(handle: number): void;
}

/** Construction options for `TabStripDragScroller`'s momentum tail. */
export interface TabStripDragOptions {
  /** Scheduler the fling runs on; defaults to the browser's rAF (SSR: none). */
  scheduler?: TabStripFrameScheduler;
  /**
   * Invoked once per momentum fling when it settles — decayed past the stop
   * threshold, clamped at a strip edge, or halted by `stopFling`.
   */
  onFlingSettled?: () => void;
}

/** The browser scheduler when it exists; a missing rAF (SSR) disables the fling. */
const rafScheduler: TabStripFrameScheduler | undefined =
  typeof requestAnimationFrame === 'function'
    ? {
        requestFrame: (callback) => requestAnimationFrame(callback),
        cancelFrame: (handle) => cancelAnimationFrame(handle),
      }
    : undefined;

/** One pointer position sample feeding the release-velocity estimate. */
interface FlingSample {
  x: number;
  t: number;
}

/**
 * Reads a pointer event's high-resolution timestamp, falling back to
 * performance.now() for the plain-object stand-ins unit tests dispatch.
 */
function timestampOf(event: PointerEvent): number {
  const t = (event as { timeStamp?: number }).timeStamp;
  return typeof t === 'number' && Number.isFinite(t) && t > 0 ? t : performance.now();
}

/**
 * Touch/pen counterpart of `scrollTabStripOnWheel`: tracks a horizontal swipe
 * that starts on the tab strip and drags the strip with the finger, then on
 * release continues with a momentum fling whose speed decays exponentially
 * from the finger's trailing velocity — the strip coasts to a stop instead
 * of freezing the instant the finger lifts. A gesture that travels past the
 * slop threshold marks the following click for suppression, so swiping never
 * selects the tab the swipe started on.
 */
export class TabStripDragScroller {
  private pointerId: number | null = null;
  private startX = 0;
  private startDistance = 0;
  private moved = false;
  private header: ScrollableTabHeader | undefined;
  private samples: FlingSample[] = [];
  private readonly scheduler: TabStripFrameScheduler | undefined;
  private readonly onFlingSettled?: () => void;
  private flinging = false;
  private flingVelocity = 0;
  private flingLastTime: number | null = null;
  private flingHeader: ScrollableTabHeader | undefined;
  private frameHandle: number | null = null;

  constructor(options: TabStripDragOptions = {}) {
    this.scheduler = options.scheduler ?? rafScheduler;
    this.onFlingSettled = options.onFlingSettled;
  }

  /**
   * Begins tracking a potential drag. Only primary touch/pen pointers that
   * start on the strip qualify; mouse users scroll with the wheel and chevrons.
   * A grab on the strip also halts any fling still coasting from a previous
   * swipe — the finger catches the strip where it is.
   */
  onPointerDown(header: ScrollableTabHeader | undefined, event: PointerEvent): void {
    this.pointerId = null;
    this.moved = false;
    this.samples = [];
    if (!header || !event.isPrimary || event.pointerType === 'mouse') {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (!target?.closest('.mat-mdc-tab-header')) {
      return;
    }
    this.stopFling();
    this.pointerId = event.pointerId;
    this.header = header;
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
  onPointerMove(header: ScrollableTabHeader | undefined, event: PointerEvent): boolean {
    if (this.pointerId === null || event.pointerId !== this.pointerId || !header) {
      return false;
    }
    this.header = header;
    this.samples.push({ x: event.clientX, t: timestampOf(event) });
    if (this.samples.length > 32) {
      this.samples.splice(0, this.samples.length - 32);
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

  /**
   * Ends tracking on finger lift. A release faster than the fling threshold
   * hands the strip to a momentum animation; returns whether it did.
   */
  onPointerUp(event: PointerEvent): boolean {
    if (event.pointerId !== this.pointerId) {
      return false;
    }
    const header = this.header;
    // The strip scrolls opposite the finger, so the fling velocity is the
    // negated trailing finger speed; the release position itself is a sample.
    this.samples.push({ x: event.clientX, t: timestampOf(event) });
    const fingerVelocity = this.trailingFingerVelocity();
    const velocity = -fingerVelocity;
    const flings =
      !!header &&
      !!this.scheduler &&
      Math.abs(velocity) >= TAB_STRIP_FLING_MIN_START_PX_PER_MS;
    this.endTracking();
    if (flings && header && this.scheduler) {
      this.beginFling(header, this.scheduler, velocity);
      return true;
    }
    return false;
  }

  /** Ends tracking without momentum — the platform took the gesture over. */
  onPointerCancel(event: PointerEvent): void {
    if (event.pointerId !== this.pointerId) {
      return;
    }
    this.endTracking();
  }

  /** Halts a running fling, if any (wheel intent, tab selection, teardown). */
  stopFling(): void {
    if (this.flinging) {
      this.settleFling();
    }
  }

  /** Returns (and clears) whether the current click follows a drag gesture. */
  consumeClickSuppression(): boolean {
    const suppress = this.moved;
    this.moved = false;
    return suppress;
  }

  /**
   * Finger speed (px/ms) over the trailing velocity window. Zero when the
   * window holds no usable span — held-still lifts and same-tick synthetic
   * events carry no trustworthy speed, so they never fling.
   */
  private trailingFingerVelocity(): number {
    const windowStart = (this.samples.at(-1)?.t ?? 0) - TAB_STRIP_FLING_VELOCITY_WINDOW_MS;
    let first: FlingSample | undefined;
    let last: FlingSample | undefined;
    for (const sample of this.samples) {
      if (sample.t < windowStart) {
        continue;
      }
      first ??= sample;
      last = sample;
    }
    if (!first || !last) {
      return 0;
    }
    const dt = last.t - first.t;
    return dt >= 5 ? (last.x - first.x) / dt : 0;
  }

  private endTracking(): void {
    this.pointerId = null;
    this.samples = [];
    // The browser dispatches the click right after pointerup; clear the flag
    // afterwards so a later keyboard-activated tab is never suppressed.
    if (this.moved) {
      setTimeout(() => (this.moved = false));
    }
  }

  private beginFling(
    header: ScrollableTabHeader,
    scheduler: TabStripFrameScheduler,
    velocityPxPerMs: number,
  ): void {
    this.flinging = true;
    this.flingVelocity = velocityPxPerMs;
    this.flingLastTime = null;
    this.flingHeader = header;
    this.frameHandle = scheduler.requestFrame(this.onFrame);
  }

  /**
   * One fling frame: integrate the decayed velocity into `scrollDistance`.
   * The setter clamps at the strip's edges — a write that changes nothing
   * means the strip hit an edge and the fling is over (no bounce-back).
   */
  private readonly onFrame = (time: number): void => {
    this.frameHandle = null;
    const scheduler = this.scheduler;
    const header = this.flingHeader;
    if (!scheduler || !header) {
      this.settleFling();
      return;
    }
    const dt = this.flingLastTime === null ? 0 : time - this.flingLastTime;
    this.flingLastTime = time;
    if (dt > 0) {
      const before = header.scrollDistance;
      header.scrollDistance = before + this.flingVelocity * dt;
      if (header.scrollDistance === before) {
        this.settleFling();
        return;
      }
      this.flingVelocity *= Math.exp(-dt / TAB_STRIP_FLING_DECAY_MS);
      if (Math.abs(this.flingVelocity) < TAB_STRIP_FLING_STOP_PX_PER_MS) {
        this.settleFling();
        return;
      }
    }
    this.frameHandle = scheduler.requestFrame(this.onFrame);
  };

  private settleFling(): void {
    if (this.frameHandle !== null) {
      this.scheduler?.cancelFrame(this.frameHandle);
      this.frameHandle = null;
    }
    this.flinging = false;
    this.flingVelocity = 0;
    this.flingLastTime = null;
    this.flingHeader = undefined;
    this.onFlingSettled?.();
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
  private readonly sessionLock = inject(SessionLockService);
  private readonly tabGroup = viewChild(MatTabGroup);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly drag = new TabStripDragScroller({
    // The fling's frames drive `scrollDistance` directly, so the 1:1 tracking
    // class must survive the release and come off only when the coast ends —
    // restoring the CSS easing mid-flight would make every frame lag.
    onFlingSettled: () => this.host.nativeElement.classList.remove('strip-dragging'),
  });

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

  protected readonly entryFor = computed<EntryLookup>(() => {
    const byId = new Map<number, CharacterBookEntry>(
      this.workspace.entries().flatMap((e) => (e.id === undefined ? [] : [[e.id, e] as const])),
    );
    return (id: number) => byId.get(id);
  });

  /**
   * Session veil (task 11 §3.3, checkpoint 11-1): covers the pane whenever
   * this tab may not edit — `blocked` (another tab holds the lock), `lost`
   * (a takeover moved it away) and the brief `relinquishing` handover.
   * `acquiring` stays unveiled on purpose: a booting tab that is genuinely
   * alone must not flash a veil (plan §7.3 — writes are allowed there).
   */
  protected readonly sessionVeiled = computed(() => {
    const state = this.sessionLock.state();
    switch (state) {
      case 'blocked':
      case 'lost':
      case 'relinquishing':
        return true;
      case 'idle':
      case 'acquiring':
      case 'held':
        return false;
      default: {
        // Union-level exhaustiveness (the runBarAction precedent): a new
        // `SessionLockState` member added without a case must not silently
        // read as editable.
        const unhandled: never = state;
        throw new Error(`Unhandled session lock state: ${String(unhandled)}`);
      }
    }
  });

  /** The veil's Take over action — offered only where a retry makes sense. */
  protected readonly sessionCanRetry = computed(() => {
    const state = this.sessionLock.state();
    switch (state) {
      case 'blocked':
      case 'lost':
        return true;
      case 'idle':
      case 'acquiring':
      case 'held':
      case 'relinquishing':
        return false;
      default: {
        // Union-level exhaustiveness (the runBarAction precedent): a new
        // `SessionLockState` member added without a case must not silently
        // hide the retry affordance.
        const unhandled: never = state;
        throw new Error(`Unhandled session lock state: ${String(unhandled)}`);
      }
    }
  });

  /** Veil retry: same handshake the topbar pill and the prompt drive. */
  protected retryTakeover(): void {
    void this.sessionLock.takeover();
  }

  constructor() {
    // Self-healing selection: if the active tab id is gone (e.g. its entry was
    // deleted), fall back to the first open tab so the pane never blanks out.
    effect(() => {
      const tabs = this.tabs();
      const id = this.workspace.activeTabId();
      if (tabs.length && !tabs.some((tab) => tab.id === id)) {
        this.workspace.activeTabId.set(tabs[0]?.id ?? null);
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
    inject(DestroyRef).onDestroy(() => {
      hostElement.removeEventListener('click', suppressDragClick, true);
      this.drag.stopFling();
    });
  }

  protected tabTitle(entry: CharacterBookEntry): string {
    const title = entry.comment?.trim() || entry.name?.trim();
    return title || (entry.keys.length ? entry.keys.join(', ') : `Entry ${entry.id}`);
  }

  protected onTabChange(event: MatTabChangeEvent): void {
    // Selecting a tab realigns the strip to its label; a coasting fling must
    // not fight that scroll.
    this.drag.stopFling();
    const id = this.tabs()[event.index]?.id ?? null;
    if (id !== this.workspace.activeTabId()) {
      this.workspace.activeTabId.set(id);
    }
  }

  /** Wheel support for the tab strip (see `scrollTabStripOnWheel`). */
  protected onTabStripWheel(event: WheelEvent): void {
    // `_tabHeader` is the group's internal header; it is the only handle for
    // scrolling the strip programmatically before Angular ships wheel support.
    this.drag.stopFling(); // a wheel intent preempts any running momentum.
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

  protected onStripPointerUp(event: PointerEvent): void {
    // A release that hands off to the momentum fling keeps the tracking class
    // until the coast settles (removed by `onFlingSettled`).
    if (!this.drag.onPointerUp(event)) {
      this.host.nativeElement.classList.remove('strip-dragging');
    }
  }

  protected onStripPointerCancel(event: PointerEvent): void {
    // The platform claimed the gesture: no momentum, class comes off now.
    this.drag.onPointerCancel(event);
    this.host.nativeElement.classList.remove('strip-dragging');
  }

  /** Removes a tab without selecting it (the label click selects otherwise). */
  protected closeTab(event: MouseEvent, entryId: number): void {
    event.stopPropagation();
    this.workspace.closeTab(entryId);
  }
}
