import { DestroyRef, Service, computed, inject, signal } from '@angular/core';

/**
 * Per-project session lock (task 11 §3.1) — at most one tab per browser
 * profile edits a given project at a time.
 *
 * The active project's lock is named `lorestitch-project:<id>` and is probed
 * through the Web Locks API with `{ ifAvailable: true }` (locked decision
 * 3.0.2 — Web Locks only, no heartbeat/election fallback). Holding follows
 * the standard hold-for-tab-lifetime pattern: the grant callback returns a
 * promise that resolves only when this tab releases. `BroadcastChannel`
 * carries the takeover handshake and nothing else; every message names its
 * project and listeners filter foreign projects. When `navigator.locks` is
 * absent (jsdom, older webviews) the service degrades straight to `held` —
 * the pre-lock status quo for those browsers.
 *
 * `steal: true` is deliberately excluded (§3.0.2/§7.2): it releases the
 * holder without cooperation, so no flush runs — destructive, the exact
 * behavior this task removes.
 */
export type SessionLockState =
  | 'idle' // no project open — nothing locked
  | 'acquiring' // probe in flight — writes allowed (plan §7.3)
  | 'held' // this tab owns the project's lock
  | 'blocked' // another tab owns it; takeover-prompt territory
  | 'relinquishing' // takeover requested of us; flushing + releasing
  | 'lost'; // we gave the lock away; read-only

/** Channel name carrying the takeover handshake (and nothing else). */
export const SESSION_LOCK_CHANNEL_NAME = 'lorestitch-project-lock';

/** Slow re-probe cadence while `blocked`/`lost` (plan §3.4). */
export const SESSION_REPROBE_INTERVAL_MS = 30_000;

/** Web Locks name for a project's session lock. */
export function sessionLockName(projectId: string): string {
  return `lorestitch-project:${projectId}`;
}

/** Hooks registered at attach; `flush` runs before any release (§3.1). */
interface SessionLockHooks {
  flush: () => Promise<void> | void;
}

interface LockRequestOptions {
  ifAvailable?: boolean;
}

interface LockLike {
  readonly name: string;
  readonly mode: string;
}

type LockGrantedCallback = (lock: LockLike | null) => Promise<unknown> | unknown;

/** Structural seam over `LockManager` so specs can install fakes on the globals. */
interface LockManagerLike {
  request(name: string, options: LockRequestOptions, callback: LockGrantedCallback): Promise<unknown>;
}

/** Structural seam over `BroadcastChannel` (never jsdom's own — plan §7.7). */
interface BroadcastChannelLike {
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage(message: unknown): void;
  close(): void;
}

interface TakeoverMessage {
  type: 'takeover-request';
  projectId: string;
}

/**
 * One instance owns at most one project lock — the active project's. The
 * workspace attaches on `setActive` and detaches on close/delete/switch;
 * `StorageService` consumes `mayPersist`/`writeEpoch` as the fire-time gate
 * for the debounced save timer (plan §3.2).
 */
@Service()
export class SessionLockService {
  readonly state = signal<SessionLockState>('idle');

  /** True only while this tab may mutate the attached project. */
  readonly canEdit = computed<boolean>(() => {
    const state = this.state();
    return state === 'held' || state === 'acquiring';
  });

  /** Fired (signal pulse) on every write attempt made while `!canEdit`. */
  readonly blockedAttempt = signal(0);

  /**
   * Monotonic generation of this tab's edit rights: bumped whenever `canEdit`
   * flips (attach, lock lost, lock regained). Persistence scheduled through
   * `StorageService.scheduleSave` pins the epoch it was produced under, so a
   * write that slipped through while `acquiring` can never land once the tab
   * has been `blocked`/`lost` in between — even after a re-acquire (plan
   * §7.3).
   */
  readonly writeEpoch = signal(0);

  private attachedId: string | null = null;
  private hooks: SessionLockHooks | null = null;
  private channel: BroadcastChannelLike | null = null;
  /** Resolve handle of the currently held lock; null while not holding. */
  private releaseHeld: (() => void) | null = null;
  private reprobeTimer: ReturnType<typeof setInterval> | null = null;
  private listening = false;
  private disposed = false;

  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    this.destroyRef.onDestroy(() => this.dispose());
  }

  // ---------------------------------------------------------------------------
  // Public API (plan §3.1)
  // ---------------------------------------------------------------------------

  /**
   * Attaches the lock for `projectId` and probes for it. Any previous
   * attachment is detached first (flush + release), so switching projects
   * never holds two locks. Re-attaching to the SAME project is a no-op — the
   * reload-on-acquire path (§3.3) must never release-and-re-probe, or a
   * queued taker could grab the lock in the window.
   */
  attach(projectId: string, hooks: SessionLockHooks): void {
    if (this.disposed || this.attachedId === projectId) {
      return;
    }
    this.detach();
    this.attachedId = projectId;
    this.hooks = hooks;
    this.openChannel();
    this.addListeners();
    const locks = this.locks();
    if (locks === undefined) {
      // Absent Web Locks API (jsdom, older webviews): degrade to the pre-lock
      // status quo — this tab edits (locked decision 3.0.2).
      this.setState('held');
      return;
    }
    this.setState('acquiring');
    this.probe(locks, projectId);
  }

  /**
   * Detaches on close/delete/switch: own flush first, then release, then
   * `idle`. Detaching from `blocked`/`lost` just clears state — this tab
   * holds nothing (plan §3.1). Fire-and-forget: the flush is invoked
   * synchronously so it targets the project that is active at detach time,
   * and the release follows once it settles.
   */
  detach(): void {
    const release = this.releaseHeld;
    const hooks = this.hooks;
    this.attachedId = null;
    this.hooks = null;
    this.releaseHeld = null;
    this.removeListeners();
    this.closeChannel();
    this.setState('idle');
    if (release !== null) {
      void (async () => {
        try {
          await hooks?.flush();
        } catch {
          // Best-effort on teardown — the release must not be skipped.
        }
        release();
      })();
    }
  }

  /**
   * From `blocked`/`lost`: ask the holder to relinquish, then acquire. The
   * real (blocking) lock request is queued FIRST, then the handshake is
   * posted (§3.1 order) — the holder flushes its pending save before
   * releasing, so this tab's queued request grants only after the losing
   * tab's edits reached storage.
   *
   * Resolves once the queued request grants (state `held`), or when the
   * request settles any other way (detached mid-takeover, rejected). A hung
   * holder that never answers leaves the request queued and this promise
   * pending — the tab stays `blocked` and the notice's retry re-posts the
   * handshake (§7.2). Never rejects.
   */
  async takeover(): Promise<void> {
    const id = this.attachedId;
    if (id === null || this.disposed) {
      return;
    }
    const state = this.state();
    if (state !== 'blocked' && state !== 'lost') {
      return;
    }
    const locks = this.locks();
    if (locks === undefined) {
      return; // Unreachable where attach already degraded to `held`.
    }
    let resolveSettled: (() => void) | undefined;
    const settled = new Promise<void>((resolve) => {
      resolveSettled = resolve;
    });
    let release: (() => void) | undefined;
    const request = locks.request(sessionLockName(id), {}, () => {
      if (this.attachedId !== id) {
        return undefined; // Detached mid-takeover — give the lock straight back.
      }
      const current = this.state();
      if (current !== 'blocked' && current !== 'lost') {
        return undefined; // Raced (e.g. a re-probe already holds) — don't double-hold.
      }
      this.setState('held');
      resolveSettled?.();
      const hold = this.holdPromise();
      release = hold.release;
      this.releaseHeld = hold.release;
      return hold.promise;
    });
    // Marked handled up front (the storage.service.ts rejection lesson): the
    // request resolves only when the (re)acquired lock is released again, and
    // a hung holder leaves it pending forever.
    void request.then(
      () => {
        this.retireHold(release);
        resolveSettled?.();
      },
      () => {
        this.retireHold(release);
        resolveSettled?.();
      },
    );
    // Queue FIRST, post the handshake SECOND (plan §3.1).
    this.postMessage({ type: 'takeover-request', projectId: id });
    await settled;
  }

  /**
   * Point probe (checkpoint 11-1 decision): resolves true when `projectId`'s
   * lock is currently held ELSEWHERE — i.e. importing or otherwise overwriting
   * that project from this tab would clobber another tab's edits. A grant
   * means the lock is free: the callback returns synchronously so nothing is
   * held, not even for a microtask. Absent `navigator.locks` resolves false —
   * proceed, the pre-lock status quo. A rejecting request could not verify
   * "free", so it resolves true (abort the destructive operation).
   *
   * The attached lock is never disturbed: a different project probes a
   * different name, and a same-id probe rides `{ ifAvailable: true }`, which
   * never queues. An id THIS tab holds (and may edit) resolves false without
   * probing — self-held is not "held elsewhere".
   */
  async isHeldElsewhere(projectId: string): Promise<boolean> {
    if (this.disposed || (this.attachedId === projectId && this.canEdit())) {
      return false;
    }
    const locks = this.locks();
    if (locks === undefined) {
      return false;
    }
    let held = true;
    const request = locks.request(sessionLockName(projectId), { ifAvailable: true }, (lock) => {
      held = !lock;
      return undefined;
    });
    // Marked handled up front (the storage.service.ts rejection lesson): the
    // probe's own settlement must never surface as an unhandled rejection.
    const settled = request.then(
      () => undefined,
      () => undefined,
    );
    await settled;
    return held;
  }

  /**
   * Fire-time persistence gate for the debounced save timer (plan §3.2):
   * false only when `projectId` is the attached project and this tab may not
   * currently edit it. Projects with no attached lock are ungated.
   */
  mayPersist(projectId: string): boolean {
    return this.attachedId !== projectId || this.canEdit();
  }

  /** Pulses `blockedAttempt` (the shell turns each pulse into the snackbar). */
  pulseBlockedAttempt(): void {
    this.blockedAttempt.update((count) => count + 1);
  }

  // ---------------------------------------------------------------------------
  // Probe / re-probe
  // ---------------------------------------------------------------------------

  /** One-shot `{ ifAvailable: true }` probe that holds on success (§3.1). */
  private probe(locks: LockManagerLike, id: string): void {
    let release: (() => void) | undefined;
    const request = locks.request(sessionLockName(id), { ifAvailable: true }, (lock) => {
      if (this.attachedId !== id) {
        return undefined; // Detached mid-probe — never hold.
      }
      if (!lock) {
        // Taken: another tab holds the project's lock.
        if (this.state() === 'acquiring') {
          this.setState('blocked');
        }
        return undefined;
      }
      if (this.state() !== 'acquiring') {
        return undefined; // Raced (a takeover/re-probe already holds) — don't double-hold.
      }
      this.setState('held');
      const hold = this.holdPromise();
      release = hold.release;
      this.releaseHeld = hold.release;
      return hold.promise;
    });
    // Marked handled up front (the storage.service.ts rejection lesson): a
    // granted probe's request promise resolves only when the lock is released
    // again, possibly never within this tab's lifetime.
    void request.then(
      () => this.retireHold(release),
      () => {
        this.retireHold(release);
        // A rejecting probe degrades to `blocked` — data-safe, and the §3.4
        // re-probe self-heals a transient failure.
        if (this.attachedId === id && this.state() === 'acquiring') {
          this.setState('blocked');
        }
      },
    );
  }

  /**
   * Stale-holder recovery (plan §3.4): the holder closing/crashing without
   * the handshake releases the lock silently, so while `blocked`/`lost` this
   * tab re-probes on visibility/focus and the slow timer. Probe success ⇒
   * `held` ⇒ the shell's reload-on-acquire path.
   */
  private reprobe(): void {
    const id = this.attachedId;
    if (id === null || this.disposed) {
      return;
    }
    const state = this.state();
    if (state !== 'blocked' && state !== 'lost') {
      return;
    }
    const locks = this.locks();
    if (locks === undefined) {
      return;
    }
    let release: (() => void) | undefined;
    const request = locks.request(sessionLockName(id), { ifAvailable: true }, (lock) => {
      if (this.attachedId !== id || !lock) {
        return undefined; // Detached, or still taken — stay put.
      }
      const current = this.state();
      if (current !== 'blocked' && current !== 'lost') {
        return undefined; // A takeover grant got here first — don't double-hold.
      }
      this.setState('held');
      const hold = this.holdPromise();
      release = hold.release;
      this.releaseHeld = hold.release;
      return hold.promise;
    });
    void request.then(
      () => this.retireHold(release),
      () => this.retireHold(release),
    );
  }

  /** Hold-for-tab-lifetime promise: resolves only when this tab releases. */
  private holdPromise(): { promise: Promise<void>; release: () => void } {
    let release: (() => void) | undefined;
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    return { promise, release: () => release?.() };
  }

  /** Retires a settled acquisition's release handle without clobbering a newer one. */
  private retireHold(release: (() => void) | undefined): void {
    if (release !== undefined && this.releaseHeld === release) {
      this.releaseHeld = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Takeover handshake (holder side)
  // ---------------------------------------------------------------------------

  private onMessage(event: { data: unknown }): void {
    const message = event.data as Partial<TakeoverMessage> | null | undefined;
    if (
      message === null ||
      typeof message !== 'object' ||
      message.type !== 'takeover-request' ||
      typeof message.projectId !== 'string'
    ) {
      return;
    }
    // Foreign-project filter: a third tab blocked on another project ignores
    // this handshake (plan §3.1).
    if (this.attachedId !== message.projectId || this.state() !== 'held') {
      return;
    }
    this.setState('relinquishing');
    const release = this.releaseHeld;
    this.releaseHeld = null;
    const hooks = this.hooks;
    const id = message.projectId;
    // Non-destructive pin (plan §3.1): the registered flush runs BEFORE the
    // lock is released, so the requester's queued request grants only after
    // our pending save reached storage. The flush is invoked synchronously so
    // it targets the project that is active right now.
    void (async () => {
      try {
        await hooks?.flush();
      } catch {
        // Best-effort — losing tab degrades to read-only regardless.
      }
      release?.();
      if (this.attachedId === id && this.state() === 'relinquishing') {
        this.setState('lost');
      }
    })();
  }

  // ---------------------------------------------------------------------------
  // Platform seams (lazy off the globals — plan §3.1)
  // ---------------------------------------------------------------------------

  private locks(): LockManagerLike | undefined {
    return (globalThis as { navigator?: { locks?: LockManagerLike } }).navigator?.locks;
  }

  private openChannel(): void {
    if (this.channel !== null) {
      return;
    }
    const ctor = (globalThis as { BroadcastChannel?: new (name: string) => BroadcastChannelLike })
      .BroadcastChannel;
    if (ctor === undefined) {
      return; // Handshake unavailable; locking itself still works (§3.0.2).
    }
    try {
      this.channel = new ctor(SESSION_LOCK_CHANNEL_NAME);
      this.channel.onmessage = (event) => this.onMessage(event);
    } catch {
      this.channel = null; // e.g. opaque origin — best-effort handshake.
    }
  }

  private closeChannel(): void {
    try {
      this.channel?.close();
    } catch {
      // Already closed — nothing to do.
    }
    this.channel = null;
  }

  private postMessage(message: TakeoverMessage): void {
    try {
      this.channel?.postMessage(message);
    } catch {
      // A closed/unavailable channel only costs the handshake, never the lock.
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle listeners (pagehide flush §3.5, re-probe triggers §3.4)
  // ---------------------------------------------------------------------------

  private readonly onPageHide = (): void => {
    this.flushAttached();
  };

  private readonly onVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') {
      this.flushAttached();
    } else {
      this.reprobe();
    }
  };

  private readonly onFocus = (): void => {
    this.reprobe();
  };

  private addListeners(): void {
    if (this.listening) {
      return;
    }
    this.listening = true;
    window.addEventListener('pagehide', this.onPageHide);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    window.addEventListener('focus', this.onFocus);
  }

  private removeListeners(): void {
    if (!this.listening) {
      return;
    }
    this.listening = false;
    window.removeEventListener('pagehide', this.onPageHide);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    window.removeEventListener('focus', this.onFocus);
  }

  /**
   * Best-effort flush of the attached project (plan §3.5): cancels the 400 ms
   * storage debounce and starts the IndexedDB write now. Reliable on hide
   * (tab switch, minimize, phone screen off); the browser may not finish the
   * transaction on a true unload. Never awaits.
   */
  private flushAttached(): void {
    const hooks = this.hooks;
    if (hooks === null) {
      return;
    }
    void (async () => {
      try {
        await hooks.flush();
      } catch {
        // Best-effort on unload.
      }
    })();
  }

  // ---------------------------------------------------------------------------
  // State transitions
  // ---------------------------------------------------------------------------

  private setState(next: SessionLockState): void {
    const couldEdit = this.canEdit();
    this.state.set(next);
    if (this.canEdit() !== couldEdit) {
      this.writeEpoch.update((epoch) => epoch + 1);
    }
    if (next === 'blocked' || next === 'lost') {
      this.armReprobe();
    } else {
      this.disarmReprobe();
    }
  }

  private armReprobe(): void {
    if (this.reprobeTimer !== null || this.disposed) {
      return;
    }
    this.reprobeTimer = setInterval(() => this.reprobe(), SESSION_REPROBE_INTERVAL_MS);
  }

  private disarmReprobe(): void {
    if (this.reprobeTimer !== null) {
      clearInterval(this.reprobeTimer);
      this.reprobeTimer = null;
    }
  }

  private dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.detach();
    this.disarmReprobe();
  }
}
