import { TestBed } from '@angular/core/testing';
import {
  SESSION_LOCK_CHANNEL_NAME,
  SESSION_REPROBE_INTERVAL_MS,
  SessionLockService,
  sessionLockName,
} from './session-lock.service';
import {
  flushMicrotasks,
  installSessionLockFakes,
  type SessionLockFakes,
} from '../../../testing/session-lock-fakes';

/**
 * The plan 11 §3.6 unit matrix, row 1, against fake `navigator.locks` + fake
 * `BroadcastChannel` installed on the globals BEFORE the service under test
 * is constructed (the match-media-stub precedent — jsdom has no
 * `navigator.locks` and its BroadcastChannel is never relied on).
 */

/** A flush hook the spec controls: counts calls and settles on demand. */
function deferredFlush(): { hook: () => Promise<void>; calls: () => number; settle: () => void } {
  let resolveFlush: (() => void) | undefined;
  let calls = 0;
  const pending = new Promise<void>((resolve) => {
    resolveFlush = resolve;
  });
  return {
    hook: () => {
      calls += 1;
      return pending;
    },
    calls: () => calls,
    settle: () => resolveFlush?.(),
  };
}

describe('SessionLockService', () => {
  let fakes: SessionLockFakes;
  let service: SessionLockService;

  function makeService(): SessionLockService {
    TestBed.configureTestingModule({});
    return (service = TestBed.inject(SessionLockService));
  }

  beforeEach(() => {
    fakes = installSessionLockFakes();
  });

  afterEach(() => {
    service?.detach();
    fakes.restore();
    vi.useRealTimers();
  });

  it('probe free ⇒ held, and the tab actually holds the lock', async () => {
    makeService();
    service.attach('p1', { flush: () => undefined });
    expect(service.state()).toBe('acquiring');
    await flushMicrotasks();

    expect(service.state()).toBe('held');
    expect(service.canEdit()).toBe(true);
    expect(fakes.locks.isHeld(sessionLockName('p1'))).toBe(true);
  });

  it('probe taken ⇒ blocked, and canEdit is false', async () => {
    makeService();
    const releaseHolder = await fakes.locks.holdFromOutside(sessionLockName('p1'));
    service.attach('p1', { flush: () => undefined });
    await flushMicrotasks();

    expect(service.state()).toBe('blocked');
    expect(service.canEdit()).toBe(false);
    // No probe success means no re-probe-due state: the timer is armed for §3.4.
    releaseHolder();
  });

  it('absent APIs ⇒ held immediately (pre-lock status quo degradation)', () => {
    fakes.restore();
    fakes = installSessionLockFakes();
    // Remove the locks fake only: the plan's degradation is per-API.
    Reflect.deleteProperty(globalThis.navigator as unknown as Record<string, unknown>, 'locks');

    makeService();
    service.attach('p1', { flush: () => undefined });
    // Synchronous, before any microtask could run.
    expect(service.state()).toBe('held');
    expect(service.canEdit()).toBe(true);
    // Without locks there is nothing to hold and no takeover channel traffic.
    expect(fakes.locks.requests).toHaveLength(0);
  });

  it('takeover-request runs the holder flush BEFORE releasing the lock (order pin)', async () => {
    makeService();
    const flush = deferredFlush();
    service.attach('p1', { flush: flush.hook });
    await flushMicrotasks();
    expect(service.state()).toBe('held');

    const channel = fakes.channels[0];
    assert(channel);
    expect(channel.name).toBe(SESSION_LOCK_CHANNEL_NAME);
    channel.receive({ type: 'takeover-request', projectId: 'p1' });

    // The handshake flips to `relinquishing` and the flush starts, but the
    // lock is still held while the flush is in flight.
    expect(service.state()).toBe('relinquishing');
    expect(service.canEdit()).toBe(false);
    expect(flush.calls()).toBe(1);
    expect(fakes.locks.isHeld(sessionLockName('p1'))).toBe(true);

    flush.settle();
    await flushMicrotasks();
    // Only after the flush settled does the lock free up, and the holder
    // degrades to `lost`.
    expect(fakes.locks.isHeld(sessionLockName('p1'))).toBe(false);
    expect(service.state()).toBe('lost');
    expect(service.canEdit()).toBe(false);
  });

  it('takeover queues the blocking request first, posts the handshake, and grants on relinquish', async () => {
    makeService();
    const releaseHolder = await fakes.locks.holdFromOutside(sessionLockName('p1'));
    service.attach('p1', { flush: () => undefined });
    await flushMicrotasks();
    expect(service.state()).toBe('blocked');

    const taking = service.takeover();
    await flushMicrotasks();
    // The real (blocking) request is queued and the handshake is posted.
    expect(fakes.locks.queuedCount(sessionLockName('p1'))).toBe(1);
    expect(fakes.locks.requests.at(-1)).toMatchObject({
      name: sessionLockName('p1'),
      ifAvailable: false,
    });
    const channel = fakes.channels[0];
    assert(channel);
    expect(channel.posted).toEqual([{ type: 'takeover-request', projectId: 'p1' }]);
    // A live holder keeps the requester blocked.
    expect(service.state()).toBe('blocked');

    // The holder relinquishes: the queued request grants without any new
    // probe — `relinquished`-then-grant ⇒ held — and takeover() resolves.
    releaseHolder();
    await flushMicrotasks();
    await expect(taking).resolves.toBeUndefined();
    expect(service.state()).toBe('held');
    expect(service.canEdit()).toBe(true);
    expect(fakes.locks.isHeld(sessionLockName('p1'))).toBe(true);
  });

  it('hung holder ⇒ stays blocked; a retry re-posts the handshake', async () => {
    makeService();
    await fakes.locks.holdFromOutside(sessionLockName('p1'));
    service.attach('p1', { flush: () => undefined });
    await flushMicrotasks();

    const channel = fakes.channels[0];
    assert(channel);
    void service.takeover();
    await flushMicrotasks();
    expect(service.state()).toBe('blocked');
    expect(channel.posted).toHaveLength(1);

    // The notice's retry re-posts; the hung holder keeps the lock (§7.2).
    void service.takeover();
    await flushMicrotasks();
    expect(service.state()).toBe('blocked');
    expect(channel.posted).toHaveLength(2);
    expect(fakes.locks.queuedCount(sessionLockName('p1'))).toBe(2);
  });

  it('takeover outside blocked/lost is a no-op (no handshake posted)', async () => {
    makeService();
    service.attach('p1', { flush: () => undefined });
    await flushMicrotasks();
    expect(service.state()).toBe('held');

    await expect(service.takeover()).resolves.toBeUndefined();
    const channel = fakes.channels[0];
    assert(channel);
    expect(channel.posted).toHaveLength(0);
    expect(service.state()).toBe('held');
  });

  it('detach flushes, then releases, then goes idle (order pin)', async () => {
    makeService();
    const flush = deferredFlush();
    service.attach('p1', { flush: flush.hook });
    await flushMicrotasks();
    expect(service.state()).toBe('held');

    service.detach();
    // The flush is invoked synchronously at detach time, before the release.
    expect(flush.calls()).toBe(1);
    expect(fakes.locks.isHeld(sessionLockName('p1'))).toBe(true);

    flush.settle();
    await flushMicrotasks();
    expect(fakes.locks.isHeld(sessionLockName('p1'))).toBe(false);
    expect(service.state()).toBe('idle');
    expect(service.canEdit()).toBe(false);
  });

  it('detach from blocked/lost just clears state (this tab holds nothing)', async () => {
    makeService();
    const flush = deferredFlush();
    const releaseHolder = await fakes.locks.holdFromOutside(sessionLockName('p1'));
    service.attach('p1', { flush: flush.hook });
    await flushMicrotasks();
    expect(service.state()).toBe('blocked');

    service.detach();
    expect(service.state()).toBe('idle');
    expect(flush.calls()).toBe(0);
    // The foreign holder still owns the lock; nothing was released by us.
    expect(fakes.locks.isHeld(sessionLockName('p1'))).toBe(true);
    releaseHolder();
  });

  it('re-attaching the same project is a no-op (no release-and-re-probe window)', async () => {
    makeService();
    service.attach('p1', { flush: () => undefined });
    await flushMicrotasks();
    expect(service.state()).toBe('held');

    service.attach('p1', { flush: () => undefined });
    await flushMicrotasks();
    // Held continuously: the lock was never given up, so a queued taker could
    // not have slipped in (the reload-on-acquire safety property).
    expect(fakes.locks.isHeld(sessionLockName('p1'))).toBe(true);
    expect(service.state()).toBe('held');
    // Only the original probe ran.
    expect(fakes.locks.requests).toHaveLength(1);
  });

  it('re-probe on window focus flips blocked ⇒ held after the holder releases', async () => {
    makeService();
    const releaseHolder = await fakes.locks.holdFromOutside(sessionLockName('p1'));
    service.attach('p1', { flush: () => undefined });
    await flushMicrotasks();
    expect(service.state()).toBe('blocked');

    // The holder dies silently: the lock frees, but nobody notifies this tab.
    releaseHolder();
    await flushMicrotasks();
    expect(service.state()).toBe('blocked');

    window.dispatchEvent(new Event('focus'));
    await flushMicrotasks();
    expect(service.state()).toBe('held');
    expect(service.canEdit()).toBe(true);
    expect(fakes.locks.isHeld(sessionLockName('p1'))).toBe(true);
  });

  it('re-probe on visibilitychange-to-visible flips lost ⇒ held once free', async () => {
    makeService();
    service.attach('p1', { flush: () => undefined });
    await flushMicrotasks();
    const channel = fakes.channels[0];
    assert(channel);
    // Take this tab all the way through the handshake to `lost` (no-op flush
    // hook: the chain completes within the drain).
    channel.receive({ type: 'takeover-request', projectId: 'p1' });
    await flushMicrotasks();
    expect(service.state()).toBe('lost');
    expect(fakes.locks.isHeld(sessionLockName('p1'))).toBe(false);

    // The tab that took over has died since — the lock is free again, but
    // nobody notifies a `lost` tab either; the visibility re-probe picks it up.
    document.dispatchEvent(new Event('visibilitychange'));
    await flushMicrotasks();
    expect(service.state()).toBe('held');
  });

  it('re-probe timer flips blocked ⇒ held; a live holder is respected', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    makeService();
    const releaseHolder = await fakes.locks.holdFromOutside(sessionLockName('p1'));
    service.attach('p1', { flush: () => undefined });
    await flushMicrotasks();
    expect(service.state()).toBe('blocked');

    // A live holder survives every re-probe tick.
    await vi.advanceTimersByTimeAsync(SESSION_REPROBE_INTERVAL_MS);
    expect(service.state()).toBe('blocked');

    releaseHolder();
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(SESSION_REPROBE_INTERVAL_MS);
    expect(service.state()).toBe('held');
  });

  it('foreign-project handshake messages are filtered (third-tab case)', async () => {
    makeService();
    const flush = deferredFlush();
    const releaseHolder = await fakes.locks.holdFromOutside(sessionLockName('other'));
    service.attach('other', { flush: flush.hook });
    await flushMicrotasks();
    expect(service.state()).toBe('blocked');

    const channel = fakes.channels[0];
    assert(channel);
    // A takeover handshake for a DIFFERENT project must be ignored.
    channel.receive({ type: 'takeover-request', projectId: 'p1' });
    await flushMicrotasks();
    expect(service.state()).toBe('blocked');
    expect(flush.calls()).toBe(0);
    releaseHolder();
  });

  it('malformed handshake messages are ignored', async () => {
    makeService();
    const flush = deferredFlush();
    service.attach('p1', { flush: flush.hook });
    await flushMicrotasks();
    const channel = fakes.channels[0];
    assert(channel);

    channel.receive(null);
    channel.receive({ type: 'something-else', projectId: 'p1' });
    channel.receive({ type: 'takeover-request', projectId: 42 });
    channel.receive({ type: 'takeover-request' });
    await flushMicrotasks();
    expect(service.state()).toBe('held');
    expect(flush.calls()).toBe(0);
  });

  it('pagehide flushes the attached project (plan §3.5)', async () => {
    makeService();
    const flush = deferredFlush();
    service.attach('p1', { flush: flush.hook });
    await flushMicrotasks();

    window.dispatchEvent(new Event('pagehide'));
    await flushMicrotasks();
    expect(flush.calls()).toBe(1);
    // Best-effort: the flush starting does not release anything.
    expect(service.state()).toBe('held');
    flush.settle();
  });

  it('visibilitychange to hidden flushes; a flush failure never escapes', async () => {
    makeService();
    const failing = vi.fn(() => Promise.reject(new Error('storage gone')));
    service.attach('p1', { flush: failing });
    await flushMicrotasks();

    const documentTarget = document as unknown as Record<string, unknown>;
    Object.defineProperty(documentTarget, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    await flushMicrotasks();
    expect(failing).toHaveBeenCalledTimes(1);
    Reflect.deleteProperty(documentTarget, 'visibilityState');
  });

  it('writeEpoch bumps exactly on edit-rights flips, not on every transition', async () => {
    makeService();
    expect(service.writeEpoch()).toBe(0);
    service.attach('p1', { flush: () => undefined });
    await flushMicrotasks();
    // idle → acquiring → held: rights gained once, then unchanged.
    expect(service.writeEpoch()).toBe(1);

    const channel = fakes.channels[0];
    assert(channel);
    channel.receive({ type: 'takeover-request', projectId: 'p1' });
    await flushMicrotasks();
    // held → relinquishing → lost: rights lost once, then unchanged.
    expect(service.state()).toBe('lost');
    expect(service.writeEpoch()).toBe(2);

    service.detach();
    // lost → idle: still no rights, no bump.
    expect(service.writeEpoch()).toBe(2);
  });
});
