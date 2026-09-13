import { scrollTabStripOnWheel } from './entry-editor';

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
