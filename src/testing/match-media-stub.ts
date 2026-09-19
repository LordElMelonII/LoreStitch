import {
  DESKTOP_BREAKPOINT_QUERY,
  MOBILE_BREAKPOINT_QUERY,
} from '../app/shared/constants/breakpoints';

/**
 * jsdom has no matchMedia; install a stub whose desktop/mobile answers can be
 * flipped mid-test (the CDK observer reacts to change events, exactly like a
 * browser).
 */
export function installMatchMediaStub(): {
  setDesktop: (matches: boolean) => void;
  setMobile: (matches: boolean) => void;
} {
  const state = new Map<string, boolean>([
    [DESKTOP_BREAKPOINT_QUERY, false],
    [MOBILE_BREAKPOINT_QUERY, false],
  ]);
  /** Listeners keyed by the query they observe: flips notify each with its own answer. */
  const listeners = new Map<string, Set<(event: { matches: boolean }) => void>>();
  const fake = (query: string) => ({
    get matches() {
      return state.get(query) ?? false;
    },
    media: query,
    onchange: null,
    addListener: (cb: (event: { matches: boolean }) => void) => {
      const set = listeners.get(query) ?? new Set();
      set.add(cb);
      listeners.set(query, set);
    },
    removeListener: (cb: unknown) => listeners.get(query)?.delete(cb as never),
    addEventListener: (_: string, cb: (event: { matches: boolean }) => void) =>
      listeners.get(query)?.add(cb),
    removeEventListener: (_: string, cb: unknown) => listeners.get(query)?.delete(cb as never),
    dispatchEvent: () => false,
  });
  Object.defineProperty(window, 'matchMedia', { writable: true, value: fake });
  const setQuery = (query: string, matches: boolean) => {
    state.set(query, matches);
    for (const cb of listeners.get(query) ?? []) {
      cb({ matches });
    }
  };
  return {
    setDesktop: (matches) => setQuery(DESKTOP_BREAKPOINT_QUERY, matches),
    setMobile: (matches) => setQuery(MOBILE_BREAKPOINT_QUERY, matches),
  };
}
