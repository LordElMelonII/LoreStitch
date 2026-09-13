import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import {
  TAB_STRIP_DRAG_SLOP_PX,
  EntryEditor,
  TabStripDragScroller,
  scrollTabStripOnWheel,
} from './entry-editor';
import { CharacterBookEntry, createEmptyEntry } from '../../core/models/lorebook.model';
import { WorkspaceService } from '../../core/services/workspace.service';

interface ClampableHeader {
  scrollDistance: number;
}

/** Minimal WheelEvent stand-in: the scroll logic only reads deltas and target. */
function wheelEvent(overrides: Partial<WheelEvent> = {}): WheelEvent {
  return {
    deltaX: 0,
    deltaY: 0,
    deltaMode: 0,
    target: null,
    preventDefault: () => undefined,
    ...overrides,
  } as unknown as WheelEvent;
}

/** Target that reports being inside the tab strip header. */
function headerTarget(inside: boolean): EventTarget {
  return {
    closest: (selector: string) => (inside && selector === '.mat-mdc-tab-header' ? {} : null),
  } as unknown as EventTarget;
}

describe('scrollTabStripOnWheel', () => {
  it('scrolls the header by the wheel delta and consumes the event', () => {
    const preventDefault = vi.fn();
    const header: ClampableHeader = { scrollDistance: 0 };
    const event = wheelEvent({
      deltaY: 120,
      target: headerTarget(true),
      preventDefault,
    });

    expect(scrollTabStripOnWheel(header, event)).toBe(true);
    expect(header.scrollDistance).toBe(120);
    expect(preventDefault).toHaveBeenCalledOnce();
  });

  it('combines horizontal and vertical deltas for two-axis trackpad pans', () => {
    const header: ClampableHeader = { scrollDistance: 10 };
    const event = wheelEvent({ deltaX: 40, deltaY: 80, target: headerTarget(true) });

    scrollTabStripOnWheel(header, event);
    expect(header.scrollDistance).toBe(130);
  });

  it('normalizes line-mode deltas to pixels', () => {
    const header: ClampableHeader = { scrollDistance: 0 };
    const event = wheelEvent({
      deltaY: 3,
      deltaMode: WheelEvent.DOM_DELTA_LINE,
      target: headerTarget(true),
    });

    scrollTabStripOnWheel(header, event);
    expect(header.scrollDistance).toBe(120);
  });

  it('ignores events outside the tab strip', () => {
    const header: ClampableHeader = { scrollDistance: 5 };
    const event = wheelEvent({ deltaY: 120, target: headerTarget(false) });

    expect(scrollTabStripOnWheel(header, event)).toBe(false);
    expect(header.scrollDistance).toBe(5);
  });

  it('ignores events when the header is not rendered yet', () => {
    const event = wheelEvent({ deltaY: 120, target: headerTarget(true) });

    expect(scrollTabStripOnWheel(undefined, event)).toBe(false);
  });

  it('ignores zero-delta events', () => {
    const header: ClampableHeader = { scrollDistance: 5 };
    const event = wheelEvent({ target: headerTarget(true) });

    expect(scrollTabStripOnWheel(header, event)).toBe(false);
    expect(header.scrollDistance).toBe(5);
  });

  it('does not consume the event when the strip is already at an edge', () => {
    const preventDefault = vi.fn();
    const max = 100;
    // Emulates the Material header, which clamps the distance to a valid range.
    const header = {
      distance: max,
      get scrollDistance(): number {
        return this.distance;
      },
      set scrollDistance(value: number) {
        this.distance = Math.max(0, Math.min(max, value));
      },
    };
    const event = wheelEvent({ deltaY: 120, target: headerTarget(true), preventDefault });

    expect(scrollTabStripOnWheel(header, event)).toBe(false);
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('consumes the event when the strip partially reaches an edge', () => {
    const preventDefault = vi.fn();
    const max = 100;
    const header = {
      distance: 50,
      get scrollDistance(): number {
        return this.distance;
      },
      set scrollDistance(value: number) {
        this.distance = Math.max(0, Math.min(max, value));
      },
    };
    const event = wheelEvent({ deltaY: 120, target: headerTarget(true), preventDefault });

    expect(scrollTabStripOnWheel(header, event)).toBe(true);
    expect(header.scrollDistance).toBe(max);
    expect(preventDefault).toHaveBeenCalledOnce();
  });
});

describe('TabStripDragScroller', () => {
  /** Minimal PointerEvent stand-in: the scroller only reads the basic geometry. */
  function pointerEvent(overrides: Partial<PointerEvent> = {}): PointerEvent {
    return {
      pointerId: 1,
      pointerType: 'touch',
      isPrimary: true,
      button: 0,
      clientX: 0,
      clientY: 0,
      target: null,
      ...overrides,
    } as unknown as PointerEvent;
  }

  it('drags the strip opposite to the finger once past the slop', () => {
    const header = { scrollDistance: 10 };
    const drag = new TabStripDragScroller();

    drag.onPointerDown(header, pointerEvent({ clientX: 200, target: headerTarget(true) }));
    // Within the slop nothing moves yet.
    expect(drag.onPointerMove(header, pointerEvent({ clientX: 196 }))).toBe(false);
    expect(header.scrollDistance).toBe(10);
    // A real drag scrolls opposite the finger: 80px left -> 80px forward.
    expect(drag.onPointerMove(header, pointerEvent({ clientX: 120 }))).toBe(true);
    expect(header.scrollDistance).toBe(90);
  });

  it('suppresses exactly one click after a drag', () => {
    const header = { scrollDistance: 0 };
    const drag = new TabStripDragScroller();

    drag.onPointerDown(header, pointerEvent({ clientX: 200, target: headerTarget(true) }));
    drag.onPointerMove(header, pointerEvent({ clientX: 100 }));
    drag.onPointerUp(pointerEvent());

    expect(drag.consumeClickSuppression()).toBe(true);
    expect(drag.consumeClickSuppression()).toBe(false);
  });

  it('treats small movements as taps (no scroll, no suppression)', () => {
    const header = { scrollDistance: 5 };
    const drag = new TabStripDragScroller();

    drag.onPointerDown(header, pointerEvent({ clientX: 100, target: headerTarget(true) }));
    drag.onPointerMove(header, pointerEvent({ clientX: 100 + TAB_STRIP_DRAG_SLOP_PX - 1 }));
    drag.onPointerUp(pointerEvent());

    expect(header.scrollDistance).toBe(5);
    expect(drag.consumeClickSuppression()).toBe(false);
  });

  it('ignores mouse pointers', () => {
    const header = { scrollDistance: 5 };
    const drag = new TabStripDragScroller();

    drag.onPointerDown(
      header,
      pointerEvent({ pointerType: 'mouse', clientX: 200, target: headerTarget(true) }),
    );
    drag.onPointerMove(header, pointerEvent({ pointerType: 'mouse', clientX: 100 }));

    expect(header.scrollDistance).toBe(5);
  });

  it('ignores secondary (multi-touch) pointers', () => {
    const header = { scrollDistance: 5 };
    const drag = new TabStripDragScroller();

    drag.onPointerDown(
      header,
      pointerEvent({ isPrimary: false, clientX: 200, target: headerTarget(true) }),
    );
    drag.onPointerMove(header, pointerEvent({ isPrimary: false, clientX: 100 }));

    expect(header.scrollDistance).toBe(5);
  });

  it('ignores gestures that start outside the tab strip', () => {
    const header = { scrollDistance: 5 };
    const drag = new TabStripDragScroller();

    drag.onPointerDown(header, pointerEvent({ clientX: 200, target: headerTarget(false) }));
    drag.onPointerMove(header, pointerEvent({ clientX: 100 }));

    expect(header.scrollDistance).toBe(5);
  });

  it('stops tracking after pointerup', () => {
    const header = { scrollDistance: 5 };
    const drag = new TabStripDragScroller();

    drag.onPointerDown(header, pointerEvent({ clientX: 200, target: headerTarget(true) }));
    drag.onPointerUp(pointerEvent());
    expect(drag.onPointerMove(header, pointerEvent({ clientX: 100 }))).toBe(false);
    expect(header.scrollDistance).toBe(5);
  });

  it('ignores moves from a different pointer id', () => {
    const header = { scrollDistance: 5 };
    const drag = new TabStripDragScroller();

    drag.onPointerDown(
      header,
      pointerEvent({ pointerId: 1, clientX: 200, target: headerTarget(true) }),
    );
    expect(drag.onPointerMove(header, pointerEvent({ pointerId: 2, clientX: 100 }))).toBe(false);
    expect(header.scrollDistance).toBe(5);
  });
});

/**
 * Smoke tests for the editor composition: the writing-surface sections and
 * the options accordion mount inside the active tab (which also exercises the
 * `EntryUpdatesService` wiring) and edits reach the WorkspaceService. The
 * service is stubbed so no project is needed.
 */
describe('EntryEditor fields composition', () => {
  const updateEntry = vi.fn();
  const entry: CharacterBookEntry = { ...createEmptyEntry(1), keys: ['rin'] };

  beforeEach(async () => {
    updateEntry.mockClear();
    // The tab strip pagination tracks size changes; jsdom lacks the API.
    if (!('ResizeObserver' in globalThis)) {
      /* eslint-disable @typescript-eslint/no-empty-function -- no-op stub by design */
      Object.defineProperty(globalThis, 'ResizeObserver', {
        writable: true,
        value: class {
          observe(): void {}
          unobserve(): void {}
          disconnect(): void {}
        },
      });
      /* eslint-enable @typescript-eslint/no-empty-function */
    }
    await TestBed.configureTestingModule({
      imports: [EntryEditor],
      providers: [
        provideAnimationsAsync(),
        {
          provide: WorkspaceService,
          useValue: {
            entries: signal([entry]),
            openTabEntryIds: signal([1]),
            activeTabId: signal(1),
            dirtyEntryIds: signal(new Set<number>()),
            updateEntry,
            addEntry: vi.fn(),
            closeTab: vi.fn(),
          },
        },
      ],
    }).compileComponents();
  });

  it('renders the writing surface and options accordion bound to the entry', async () => {
    const fixture = TestBed.createComponent(EntryEditor);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('app-entry-name')).toBeTruthy();
    expect(el.querySelector('app-entry-content-field')).toBeTruthy();
    expect(el.querySelector('app-entry-options-accordion')).toBeTruthy();
    // Every panel section is its own component mounted inside the accordion.
    for (const section of [
      'app-entry-placement',
      'app-entry-activation',
      'app-entry-keys',
      'app-entry-recursion-timing',
      'app-entry-matching-sources',
    ]) {
      expect(el.querySelector(`app-entry-options-accordion ${section}`)).toBeTruthy();
    }
    // Keys stay mounted inside the collapsed panel so in-place key edits
    // survive collapse/expand.
    expect(el.textContent).toContain('rin');
  });

  it('expands and collapses the option panel from the strip toggle', async () => {
    const fixture = TestBed.createComponent(EntryEditor);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const accordion = el.querySelector('app-entry-options-accordion')!;
    const toggle = accordion.querySelector<HTMLButtonElement>('.expand-toggle')!;

    expect(accordion.classList.contains('expanded')).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    toggle.click();
    await fixture.whenStable();
    expect(accordion.classList.contains('expanded')).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    toggle.click();
    await fixture.whenStable();
    expect(accordion.classList.contains('expanded')).toBe(false);
  });

  it('patches the entry through the WorkspaceService on edit', async () => {
    const fixture = TestBed.createComponent(EntryEditor);
    await fixture.whenStable();

    const nameInput = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
      'app-entry-name input',
    )!;
    nameInput.value = 'Rin Tohsaka';
    nameInput.dispatchEvent(new Event('input'));
    await fixture.whenStable();

    expect(updateEntry).toHaveBeenCalledWith(1, { comment: 'Rin Tohsaka' });
  });
});
