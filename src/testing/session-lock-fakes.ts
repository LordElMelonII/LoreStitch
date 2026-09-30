/**
 * Platform fakes for the session lock (task 11) — the `match-media-stub`
 * precedent for installing jsdom-missing APIs: install on `globalThis` BEFORE
 * the service under test is constructed and `restore()` in afterEach. The
 * service reads `navigator.locks` and `BroadcastChannel` lazily off the
 * globals, so jsdom's own (spec-incomplete) BroadcastChannel is never relied
 * on — plan 11 §3.1 platform seams, §7.7.
 */

/** Rounds of `Promise.resolve()` so fake-lock/callback chains settle. */
export async function flushMicrotasks(): Promise<void> {
  for (let round = 0; round < 10; round += 1) {
    await Promise.resolve();
  }
}

export interface FakeLockRequestRecord {
  readonly name: string;
  readonly ifAvailable: boolean;
}

/** Structural stand-in for the `Lock` argument the spec hands the callback. */
export interface FakeLockToken {
  readonly name: string;
  readonly mode: 'exclusive';
}

export type FakeLockCallback = (lock: FakeLockToken | null) => unknown;

/**
 * In-memory Web Locks manager: free names grant synchronously-on-a-microtask,
 * `ifAvailable` probes on a taken name invoke the callback with `null`, and a
 * blocking request queues FIFO until the holder's returned promise settles —
 * exactly the three behaviors `SessionLockService` builds on.
 */
export class FakeLockManager {
  private readonly heldNames = new Set<string>();
  private readonly queues = new Map<string, (() => void)[]>();
  private armedNext: {
    setName: (name: string) => void;
    setRelease: (release: () => void) => void;
  } | null = null;

  /** Log of every `request()` call, oldest first. */
  readonly requests: FakeLockRequestRecord[] = [];

  request(
    name: string,
    options: { ifAvailable?: boolean } | undefined,
    callback: FakeLockCallback,
  ): Promise<unknown> {
    this.requests.push({ name, ifAvailable: options?.ifAvailable === true });
    this.grabArmedHold(name);
    if (this.heldNames.has(name)) {
      if (options?.ifAvailable) {
        // Taken: the callback runs with `null` and the request resolves with
        // its (undefined) return value.
        return Promise.resolve().then(() => callback(null));
      }
      // Blocking: park in the FIFO queue until the name frees.
      return new Promise((resolve, reject) => {
        const queue = this.queues.get(name) ?? [];
        queue.push(() => {
          try {
            resolve(this.runCallback(name, callback));
          } catch (error) {
            reject(error);
          }
        });
        this.queues.set(name, queue);
      });
    }
    return Promise.resolve().then(() => this.runCallback(name, callback));
  }

  isHeld(name: string): boolean {
    return this.heldNames.has(name);
  }

  /** Number of blocking requests waiting for `name` (takeover queue depth). */
  queuedCount(name: string): number {
    return this.queues.get(name)?.length ?? 0;
  }

  /**
   * Simulates a foreign tab acquiring `name` as a holder. Resolves once held;
   * returns the release function (the holder "relinquishing" or dying with
   * release). Throws when the name could not be taken.
   */
  async holdFromOutside(name: string): Promise<() => void> {
    let release: (() => void) | undefined;
    void this.request(name, undefined, () => {
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    await flushMicrotasks();
    if (!release || !this.heldNames.has(name)) {
      throw new Error(`session-lock-fakes: could not take ${name} from outside`);
    }
    return () => release?.();
  }

  /**
   * Arms a phantom foreign holder that grabs whatever name the NEXT request
   * asks for — used when the name is unknowable up front (e.g. a freshly
   * minted project uuid): the service's probe then finds it taken ⇒ blocked.
   */
  holdNext(): { name: () => string | null; release: () => void } {
    const armed = { name: null as string | null, release: null as (() => void) | null };
    this.armedNext = {
      setName: (name) => {
        armed.name = name;
      },
      setRelease: (release) => {
        armed.release = release;
      },
    };
    return {
      name: () => armed.name,
      release: () => armed.release?.(),
    };
  }

  /**
   * Simulates the holder dying without any release callback: the name frees
   * and the next queued request (if any) grants, but nobody's promise is
   * resolved — the stale-holder shape of plan 11 §3.4.
   */
  forceRelease(name: string): void {
    this.heldNames.delete(name);
    this.dequeNext(name);
  }

  private grabArmedHold(name: string): void {
    const armed = this.armedNext;
    if (armed === null || this.heldNames.has(name)) {
      return;
    }
    this.armedNext = null;
    armed.setName(name);
    let release: (() => void) | undefined;
    armed.setRelease(() => release?.());
    this.heldNames.add(name);
    void new Promise<void>((resolve) => {
      release = resolve;
    }).then(() => this.free(name));
  }

  /** Runs the grant callback and adopts its hold promise, if any. */
  private runCallback(name: string, callback: FakeLockCallback): unknown {
    const hold = callback({ name, mode: 'exclusive' });
    if (hold !== null && hold !== undefined && typeof (hold as PromiseLike<unknown>).then === 'function') {
      this.heldNames.add(name);
      void Promise.resolve(hold).then(
        () => this.free(name),
        () => this.free(name),
      );
    }
    return hold;
  }

  private free(name: string): void {
    this.heldNames.delete(name);
    this.dequeNext(name);
  }

  private dequeNext(name: string): void {
    const queue = this.queues.get(name);
    const next = queue?.shift();
    if (next) {
      next();
    }
  }
}

/** Structural stand-in for the `MessageEvent` the channel hands `onmessage`. */
export interface FakeChannelMessageEvent {
  data: unknown;
}

/**
 * Fake BroadcastChannel: posts are cloned and delivered to every other live
 * instance's `onmessage` on a microtask (the real channel delivers as a
 * task). Instances register in a harness-wide live set so the spec can reach
 * the channel the service under test created.
 */
export class FakeBroadcastChannel {
  private static readonly live = new Set<FakeBroadcastChannel>();

  readonly name: string;
  onmessage: ((event: FakeChannelMessageEvent) => void) | null = null;
  closed = false;

  /** Messages this instance posted, oldest first. */
  readonly posted: unknown[] = [];

  constructor(name: string) {
    this.name = name;
    FakeBroadcastChannel.live.add(this);
  }

  postMessage(message: unknown): void {
    if (this.closed) {
      throw new Error('session-lock-fakes: postMessage on a closed channel');
    }
    this.posted.push(structuredClone(message));
    for (const peer of FakeBroadcastChannel.live) {
      if (peer === this || peer.closed) {
        continue;
      }
      const data = structuredClone(message);
      queueMicrotask(() => {
        if (!peer.closed) {
          peer.onmessage?.({ data });
        }
      });
    }
  }

  close(): void {
    this.closed = true;
    FakeBroadcastChannel.live.delete(this);
  }

  /** Delivers a message to this instance's `onmessage` synchronously. */
  receive(message: unknown): void {
    this.onmessage?.({ data: structuredClone(message) });
  }

  /** Test harness only: forget every live instance (restore() calls this). */
  static forgetAll(): void {
    for (const channel of [...FakeBroadcastChannel.live]) {
      channel.close();
    }
  }
}

export interface SessionLockFakes {
  readonly locks: FakeLockManager;
  /** Fake channels in creation order; index 0 is the service under test's. */
  readonly channels: readonly FakeBroadcastChannel[];
  /** Puts both globals back. Call in afterEach. */
  restore(): void;
}

/**
 * Installs the fake `navigator.locks` and fake `BroadcastChannel` on the
 * globals. Nested installs are tolerated (restore is LIFO-safe) as long as
 * every install is paired with a restore.
 */
export function installSessionLockFakes(): SessionLockFakes {
  const locks = new FakeLockManager();
  const channels: FakeBroadcastChannel[] = [];

  const navigatorTarget = globalThis.navigator as unknown as Record<string, unknown>;
  const locksDescriptor = Object.getOwnPropertyDescriptor(navigatorTarget, 'locks');
  Object.defineProperty(navigatorTarget, 'locks', { configurable: true, value: locks });

  const channelGlobal = globalThis as { BroadcastChannel?: unknown };
  const channelDescriptor = Object.getOwnPropertyDescriptor(channelGlobal, 'BroadcastChannel');
  channelGlobal.BroadcastChannel = class FakeBroadcastChannelCtor {
    constructor(name: string) {
      const channel = new FakeBroadcastChannel(name);
      channels.push(channel);
      return channel;
    }
  } as unknown as new (name: string) => unknown;

  let restored = false;
  return {
    locks,
    channels,
    restore() {
      if (restored) {
        return;
      }
      restored = true;
      FakeBroadcastChannel.forgetAll();
      if (locksDescriptor === undefined) {
        Reflect.deleteProperty(navigatorTarget, 'locks');
      } else {
        Object.defineProperty(navigatorTarget, 'locks', locksDescriptor);
      }
      if (channelDescriptor === undefined) {
        Reflect.deleteProperty(channelGlobal, 'BroadcastChannel');
      } else {
        Object.defineProperty(channelGlobal, 'BroadcastChannel', channelDescriptor);
      }
    },
  };
}
