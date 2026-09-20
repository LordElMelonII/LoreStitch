import { TestBed } from '@angular/core/testing';
import {
  EnvironmentInjector,
  createEnvironmentInjector,
  runInInjectionContext,
  signal,
  type WritableSignal,
} from '@angular/core';
import { type DebouncedSignal, debouncedSignal } from './debounced-signal';

const DELAY_MS = 200;

/** One debounced mirror plus the pieces the tests poke at. */
interface Harness<T> {
  readonly source: WritableSignal<T>;
  readonly debounced: DebouncedSignal<T>;
  readonly injector: EnvironmentInjector;
}

describe('debouncedSignal', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createHarness<T>(initial: T): Harness<T> {
    const source = signal<T>(initial);
    // A dedicated environment injector gives each test its own destroy
    // boundary, so cancelling-on-destroy is observable in isolation.
    const injector = createEnvironmentInjector([], TestBed.inject(EnvironmentInjector));
    const debounced = runInInjectionContext(injector, () => debouncedSignal(source, DELAY_MS));
    return { source, debounced, injector };
  }

  /**
   * Lets Angular's async effect scheduler run (it flushes queued effects on
   * a microtask), so a source change gets a chance to arm its timer.
   */
  async function runEffects(): Promise<void> {
    await vi.advanceTimersByTimeAsync(0);
  }

  it('is a constructor error outside an injection context, like effect() itself', () => {
    const source = signal('orphan');
    expect(() => debouncedSignal(source, DELAY_MS)).toThrow(/injection context/);
  });

  it('starts at the source value with no timer armed', async () => {
    const { debounced, injector } = createHarness('initial');
    await runEffects();
    expect(debounced()).toBe('initial');
    expect(vi.getTimerCount()).toBe(0);
    injector.destroy();
  });

  it('mirrors the source only after the trailing edge', async () => {
    const { source, debounced, injector } = createHarness('a');
    await runEffects();

    source.set('b');
    await runEffects();
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(DELAY_MS - 1);
    expect(debounced()).toBe('a');
    await vi.advanceTimersByTimeAsync(1);
    expect(debounced()).toBe('b');
    // Settling disarms: no timer runs while the source is idle again.
    expect(vi.getTimerCount()).toBe(0);
    injector.destroy();
  });

  it('collapses rapid changes into the last value', async () => {
    const { source, debounced, injector } = createHarness('a');
    await runEffects();

    source.set('b');
    await runEffects();
    await vi.advanceTimersByTimeAsync(DELAY_MS - 50);
    source.set('c'); // inside the window: replaces the pending value
    await runEffects();
    await vi.advanceTimersByTimeAsync(DELAY_MS - 50);
    // The restarted window has not elapsed yet.
    expect(debounced()).toBe('a');

    source.set('d');
    await runEffects();
    await vi.advanceTimersByTimeAsync(DELAY_MS - 1);
    expect(debounced()).toBe('a');
    await vi.advanceTimersByTimeAsync(1);
    expect(debounced()).toBe('d');
    injector.destroy();
  });

  it('flush() applies the pending value immediately and disarms', async () => {
    const { source, debounced, injector } = createHarness('a');
    await runEffects();

    source.set('b');
    await runEffects();
    debounced.flush();
    expect(debounced()).toBe('b');
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(DELAY_MS * 2);
    // The cancelled timer never fires a second application.
    expect(debounced()).toBe('b');

    // Flushing with nothing pending is a no-op.
    expect(() => debounced.flush()).not.toThrow();
    expect(debounced()).toBe('b');
    injector.destroy();
  });

  it('destroying the context drops the pending value instead of applying it', async () => {
    const { source, debounced, injector } = createHarness('a');
    await runEffects();

    source.set('b');
    await runEffects();
    expect(vi.getTimerCount()).toBe(1);

    injector.destroy();
    await vi.advanceTimersByTimeAsync(DELAY_MS * 2);
    expect(vi.getTimerCount()).toBe(0);
    // Destroy cancels, never flushes: the pending 'b' never lands.
    expect(debounced()).toBe('a');
  });

  it('settles again normally after a flush', async () => {
    const { source, debounced, injector } = createHarness('a');
    await runEffects();

    source.set('b');
    await runEffects();
    debounced.flush();
    expect(vi.getTimerCount()).toBe(0);

    source.set('c');
    await runEffects();
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(DELAY_MS);
    expect(debounced()).toBe('c');
    injector.destroy();
  });
});
