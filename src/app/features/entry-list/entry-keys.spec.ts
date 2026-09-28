import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MatTooltip } from '@angular/material/tooltip';
import { EntryKeys } from './entry-keys';

/**
 * jsdom lays nothing out, so the specs supply the chip metrics the browser
 * would measure: `stubMeasureWidths` shadows `offsetWidth` on the hidden
 * measurement row's chips, and the fit is driven by setting the strip width
 * directly (the ResizeObserver path has its own wiring spec).
 */
describe('EntryKeys', () => {
  let fixture: ComponentFixture<EntryKeys>;

  async function create(
    keys: string[],
    state: 'normal' | 'constant' | 'vectorized' = 'normal',
  ): Promise<EntryKeys> {
    fixture = TestBed.createComponent(EntryKeys);
    fixture.componentRef.setInput('keys', keys);
    fixture.componentRef.setInput('state', state);
    await fixture.whenStable();
    return fixture.componentInstance;
  }

  /** The visible row's chips: direct element children of the host. */
  function visibleChips(): HTMLElement[] {
    return [...(fixture.nativeElement as HTMLElement).children].filter(
      (element): element is HTMLElement => element.classList.contains('key-chip'),
    );
  }

  function keyChips(): HTMLElement[] {
    return visibleChips().filter(
      (element) =>
        !element.classList.contains('constant') &&
        !element.classList.contains('vectorized') &&
        !element.classList.contains('more'),
    );
  }

  function stateChip(): HTMLElement | null {
    return (
      visibleChips().find(
        (element) =>
          element.classList.contains('constant') || element.classList.contains('vectorized'),
      ) ?? null
    );
  }

  function counterChip(): HTMLElement | null {
    return visibleChips().find((element) => element.classList.contains('more')) ?? null;
  }

  function tooltipOf(selector: string): string | null {
    const element = fixture.debugElement.query(By.css(selector));
    assert(element);
    return element.injector.get(MatTooltip).message;
  }

  /**
   * Stubs the measurement row's chip widths in DOM order: the state chip
   * first when the state renders one, then every key chip, then the probe
   * counter.
   */
  function stubMeasureWidths(widths: number[]): void {
    const chips = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(
        '.measure-row .measure-chip',
      ),
    ];
    expect(chips).toHaveLength(widths.length);
    chips.forEach((chip, index) => {
      const width = widths[index];
      assert(width !== undefined);
      Object.defineProperty(chip, 'offsetWidth', { configurable: true, value: width });
    });
  }

  /** Drives the strip's width signal directly and settles the fit cascade. */
  async function drive(width: number): Promise<void> {
    fixture.componentInstance['containerWidth'].set(width);
    await fixture.whenStable();
  }

  it('renders every key whole and counter-free before the first measurement', async () => {
    await create(['alpha', 'beta', 'gamma']);

    expect(keyChips().map((chip) => chip.textContent?.trim())).toEqual([
      'alpha',
      'beta',
      'gamma',
    ]);
    expect(counterChip()).toBeNull();
    // The measurement row is present (invisible, out of flow) with the probe.
    expect(fixture.nativeElement.querySelector('.measure-row')).toBeTruthy();
  });

  it('hides the chips that do not fit and counts them in +N with a tooltip naming them', async () => {
    await create(['alpha', 'beta', 'gamma', 'delta']);
    stubMeasureWidths([40, 40, 40, 40, 24]);
    await drive(100); // fits one chip (40) + gap + counter (24); two need 112

    expect(keyChips().map((chip) => chip.textContent?.trim())).toEqual(['alpha']);
    expect(counterChip()?.textContent?.trim()).toBe('+3');
    expect(tooltipOf('.key-chip.more')).toBe('beta, gamma, delta');
    // Visible chips keep their own tooltips.
    expect(tooltipOf('.key-chip:not(.more)')).toBe('alpha');
  });

  it('grows the visible chips as the strip widens and drops the counter once everything fits', async () => {
    await create(['alpha', 'beta', 'gamma', 'delta']);
    stubMeasureWidths([40, 40, 40, 40, 24]);

    await drive(100);
    expect(keyChips()).toHaveLength(1);
    expect(counterChip()?.textContent?.trim()).toBe('+3');

    await drive(140); // two chips (84) + gap + counter = 112
    expect(keyChips()).toHaveLength(2);
    expect(counterChip()?.textContent?.trim()).toBe('+2');
    expect(tooltipOf('.key-chip.more')).toBe('gamma, delta');

    await drive(200); // span(4) = 172 — everything fits, no counter at all
    expect(keyChips()).toHaveLength(4);
    expect(counterChip()).toBeNull();
  });

  it('keeps the state chip visible while every key overflows into the counter', async () => {
    await create(['alpha', 'beta'], 'constant');
    // Measure row: state chip 30, keys 90 each, probe 24. Available past the
    // state chip: 110 - 30 - 4 = 76 — no key chip fits beside the counter.
    stubMeasureWidths([30, 90, 90, 24]);
    await drive(110);

    expect(stateChip()?.classList.contains('constant')).toBe(true);
    expect(keyChips()).toHaveLength(0);
    expect(counterChip()?.textContent?.trim()).toBe('+2');
    expect(tooltipOf('.key-chip.more')).toBe('alpha, beta');
  });

  it('labels a keyless normal entry and stays quiet for a keyless constant entry', async () => {
    await create([], 'normal');
    expect(fixture.nativeElement.querySelector('.no-keys')?.textContent?.trim()).toBe('no keys');
    expect(counterChip()).toBeNull();
    expect(stateChip()).toBeNull();

    await create([], 'constant');
    expect(fixture.nativeElement.querySelector('.no-keys')).toBeNull();
    expect(stateChip()?.classList.contains('constant')).toBe(true);
  });

  it('re-fits when the keys input changes', async () => {
    await create(['alpha', 'beta', 'gamma']);
    stubMeasureWidths([40, 40, 40, 24]);
    await drive(100);
    expect(keyChips()).toHaveLength(1);
    expect(counterChip()?.textContent?.trim()).toBe('+2');

    // Key edits re-materialize the measurement chips — re-stub their metrics
    // and nudge the width to re-run the fit against them.
    fixture.componentRef.setInput('keys', ['alpha', 'beta', 'gamma', 'delta']);
    await fixture.whenStable();
    stubMeasureWidths([40, 40, 40, 40, 24]);
    await drive(101);
    expect(keyChips()).toHaveLength(1);
    expect(counterChip()?.textContent?.trim()).toBe('+3');
    expect(tooltipOf('.key-chip.more')).toBe('beta, gamma, delta');
  });

  it('relabels the probe when the hidden count grows a digit and refits wider', async () => {
    await create(Array.from({ length: 12 }, (_, i) => `k${i}`));
    stubMeasureWidths([...Array<number>(12).fill(30), 24]);

    // Two chips + the "+0"-probed counter need 92; one pixel narrower, the
    // fit lands on hidden=11 — a second digit — so the probe relabels from
    // "+0" to "+11".
    await drive(91);
    expect(fixture.nativeElement.querySelector('.measure-counter')?.textContent?.trim()).toBe(
      '+11',
    );
    expect(keyChips()).toHaveLength(1);
    expect(counterChip()?.textContent?.trim()).toBe('+11');

    // Simulate the browser measuring the wider "+11" label, then widening:
    // two chips + gap + 31 = 99 exactly, and the counter reads "+10".
    stubMeasureWidths([...Array<number>(12).fill(30), 31]);
    await drive(99);
    expect(keyChips()).toHaveLength(2);
    expect(counterChip()?.textContent?.trim()).toBe('+10');
    expect(tooltipOf('.key-chip.more')).toBe(
      'k2, k3, k4, k5, k6, k7, k8, k9, k10, k11',
    );
  });

  describe('with a ResizeObserver to observe', () => {
    class RecordingResizeObserver {
      static readonly instances: RecordingResizeObserver[] = [];
      readonly observe = vi.fn();
      readonly unobserve = vi.fn();
      readonly disconnect = vi.fn();
      constructor(readonly callback: ResizeObserverCallback) {
        RecordingResizeObserver.instances.push(this);
      }
    }

    /**
     * Spec files share one jsdom environment per worker and other specs
     * (entry-editor.spec.ts) may already have installed a non-configurable
     * but writable ResizeObserver stub — so installing must replace by plain
     * assignment in that case, and only defineProperty when the property is
     * absent or configurable. The restore puts exactly the previous state
     * back (delete only what we defined).
     */
    function installRecordingObserver(): () => void {
      const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
      if (!descriptor) {
        Object.defineProperty(globalThis, 'ResizeObserver', {
          configurable: true,
          writable: true,
          value: RecordingResizeObserver,
        });
        return () => {
          delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
        };
      }
      assert(descriptor.configurable || descriptor.writable, 'cannot replace ResizeObserver');
      const previous = descriptor.value;
      (globalThis as { ResizeObserver: unknown }).ResizeObserver = RecordingResizeObserver;
      return () => {
        (globalThis as { ResizeObserver: unknown }).ResizeObserver = previous;
      };
    }

    let restoreObserver: (() => void) | undefined;

    beforeEach(() => {
      restoreObserver = installRecordingObserver();
    });

    afterEach(() => {
      restoreObserver?.();
      RecordingResizeObserver.instances.length = 0;
    });

    it('feeds the strip width from the observer and re-fits', async () => {
      fixture = TestBed.createComponent(EntryKeys);
      fixture.componentRef.setInput('keys', ['alpha', 'beta', 'gamma']);
      fixture.componentRef.setInput('state', 'normal');
      await fixture.whenStable();

      const observer = RecordingResizeObserver.instances.at(-1);
      assert(observer);
      expect(observer.observe).toHaveBeenCalledWith(fixture.nativeElement);

      // The strip reports its box; the fit consumes it without any direct
      // width driving.
      stubMeasureWidths([40, 40, 40, 24]);
      observer.callback(
        [{ contentRect: { width: 100 } } as ResizeObserverEntry],
        observer as unknown as ResizeObserver,
      );
      await fixture.whenStable();
      expect(fixture.componentInstance['containerWidth']()).toBe(100);
      expect(keyChips()).toHaveLength(1);
      expect(counterChip()?.textContent?.trim()).toBe('+2');
    });

    it('ignores zero-size reports (a closed drawer) instead of fitting against 0', async () => {
      fixture = TestBed.createComponent(EntryKeys);
      fixture.componentRef.setInput('keys', ['alpha', 'beta']);
      fixture.componentRef.setInput('state', 'normal');
      await fixture.whenStable();

      const observer = RecordingResizeObserver.instances.at(-1);
      assert(observer);
      observer.callback(
        [{ contentRect: { width: 0 } } as ResizeObserverEntry],
        observer as unknown as ResizeObserver,
      );
      await fixture.whenStable();
      expect(fixture.componentInstance['containerWidth']()).toBeNull();
    });
  });

  it('shows every chip while the strip stays unmeasured', async () => {
    // No width was driven here — whether ResizeObserver is missing (bare
    // jsdom) or present but silent, the strip is unmeasured and must render
    // every chip whole instead of hiding anything.
    const component = await create(['alpha', 'beta', 'gamma']);
    expect(component['containerWidth']()).toBeNull();
    expect(keyChips()).toHaveLength(3);
    expect(counterChip()).toBeNull();
  });
});
