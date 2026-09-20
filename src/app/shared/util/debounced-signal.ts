import { DestroyRef, effect, inject, signal, type Signal } from '@angular/core';

/** A signal that mirrors `source`, lagging at most `delayMs` behind it. */
export interface DebouncedSignal<T> extends Signal<T> {
  /** Runs a pending timer immediately (search submit, destroy). */
  flush(): void;
}

/** A value waiting for its debounce window to elapse, plus its timer. */
interface PendingValue<T> {
  readonly value: T;
  readonly timer: ReturnType<typeof setTimeout>;
}

/**
 * Trailing-edge debounced mirror of a signal.
 *
 * Both search surfaces (entries sidebar filter, Search & Replace dialog)
 * must not run their expensive scans per keystroke, but the input itself
 * stays immediate so typing never feels laggy: the form signal updates per
 * keypress and the scan consumes a mirror that settles `delayMs` after the
 * last change. Same `setTimeout` re-arm idiom as
 * `core/services/storage.service.ts` `scheduleSave` — deliberately no
 * RxJS (house rule: Signals over RxJS state).
 *
 * Contract:
 * - Starts at `source`'s current value (no initial lag).
 * - Trailing edge only: a source change within the window REPLACES the
 *   pending value (the timer re-arms per change); after `delayMs` without
 *   further changes the mirror updates to the latest value.
 * - `flush()` applies a pending value immediately and cancels its timer; a
 *   no-op when nothing is pending.
 * - Destroying the caller's injection context cancels any pending value —
 *   destroy cancels, never flushes — so a dying component cannot fire a
 *   stale update.
 * - No timer is armed while the source is idle (initial state, after a
 *   flush, after a settle), so an idle mirror costs nothing.
 *
 * The timer lifecycle rides an `effect` created in the CALLER's injection
 * context: constructing the mirror outside one is a constructor error,
 * exactly like calling `effect()` itself (NG0203).
 */
export function debouncedSignal<T>(source: Signal<T>, delayMs: number): DebouncedSignal<T> {
  let settled: T = source();
  const mirror = signal<T>(settled);
  let pending: PendingValue<T> | undefined;

  effect(() => {
    const value = source();
    // The effect's first run sees the value the mirror already holds, and
    // any later run landing back on the shown value needs no wait: arming a
    // timer here would leave one running while the source is idle.
    if (pending === undefined && Object.is(value, settled)) {
      return;
    }
    if (pending !== undefined) {
      clearTimeout(pending.timer);
    }
    pending = {
      value,
      // A keystroke within the window clears this timer and re-arms below,
      // so only the LAST value survives the window (storage.service idiom).
      timer: setTimeout(() => {
        pending = undefined;
        settled = value;
        mirror.set(value);
      }, delayMs),
    };
  });

  // Destroy drops whatever is pending instead of applying it; the effect
  // itself is destroyed with the same context.
  inject(DestroyRef).onDestroy(() => {
    if (pending !== undefined) {
      clearTimeout(pending.timer);
      pending = undefined;
    }
  });

  return Object.assign(mirror, {
    flush(): void {
      if (pending !== undefined) {
        const scheduled = pending;
        clearTimeout(scheduled.timer);
        pending = undefined;
        settled = scheduled.value;
        mirror.set(scheduled.value);
      }
    },
  });
}
