import { TestBed } from '@angular/core/testing';
import { ApplicationRef } from '@angular/core';
import { ThemeService } from './theme.service';

const DARK_QUERY = '(prefers-color-scheme: dark)';
const THEME_KEY = 'lorestitch-theme';

/**
 * jsdom has no matchMedia; install a stateful stub whose dark answer can be
 * flipped mid-test. Flipping also fires the registered `change` listeners,
 * exactly like an OS scheme switch does in a browser.
 */
function installMatchMediaStub(): { setDark: (matches: boolean) => void } {
  let darkMatches = false;
  const changeListeners = new Set<(event: { matches: boolean }) => void>();
  const fake = (query: string) => ({
    // Live getter: the service re-reads `.matches` on every change event, so
    // the flipped state must be visible on the already-created list object.
    get matches() {
      return query === DARK_QUERY && darkMatches;
    },
    media: query,
    onchange: null,
    addListener: (cb: (event: { matches: boolean }) => void) => changeListeners.add(cb),
    removeListener: (cb: unknown) => changeListeners.delete(cb as never),
    addEventListener: (_: string, cb: (event: { matches: boolean }) => void) =>
      changeListeners.add(cb),
    removeEventListener: (_: string, cb: unknown) => changeListeners.delete(cb as never),
    dispatchEvent: () => false,
  });
  Object.defineProperty(window, 'matchMedia', { writable: true, configurable: true, value: fake });
  return {
    setDark(matches: boolean) {
      darkMatches = matches;
      for (const cb of [...changeListeners]) {
        cb({ matches });
      }
    },
  };
}

describe('ThemeService', () => {
  let theme: ThemeService;
  let media: { setDark: (matches: boolean) => void };

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = '';
    media = installMatchMediaStub();
    TestBed.configureTestingModule({});
    theme = TestBed.inject(ThemeService);
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.className = '';
  });

  /** Zoneless: the class-applying effect flushes on an application tick. */
  function flushEffects(): void {
    TestBed.inject(ApplicationRef).tick();
  }

  it('defaults to system mode and tracks prefers-color-scheme', () => {
    expect(theme.mode()).toBe('system');
    expect(theme.isDark()).toBe(false);
    flushEffects();
    expect(document.documentElement.classList.contains('theme-dark')).toBe(false);

    // The OS switches to dark: the change event must apply it live.
    media.setDark(true);
    expect(theme.isDark()).toBe(true);
    expect(document.documentElement.classList.contains('theme-dark')).toBe(true);
  });

  it('applies dark mode immediately and persists the choice', () => {
    flushEffects(); // initial effect run with system/light
    theme.setMode('dark');
    flushEffects();

    // Media query says light, but the explicit choice wins.
    expect(theme.mode()).toBe('dark');
    expect(theme.isDark()).toBe(true);
    expect(document.documentElement.classList.contains('theme-dark')).toBe(true);
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');
  });

  it('applies light mode over a dark OS preference and persists it', () => {
    media.setDark(true);
    flushEffects();
    expect(theme.isDark()).toBe(true);

    theme.setMode('light');
    flushEffects();
    expect(theme.isDark()).toBe(false);
    expect(document.documentElement.classList.contains('theme-dark')).toBe(false);
    expect(localStorage.getItem(THEME_KEY)).toBe('light');
  });

  it('re-follows the OS preference live after returning to system mode', () => {
    theme.setMode('dark');
    flushEffects();
    expect(theme.isDark()).toBe(true);

    theme.setMode('system');
    media.setDark(false);
    // Media still reports light: the explicit dark choice is gone.
    expect(theme.isDark()).toBe(false);
    expect(document.documentElement.classList.contains('theme-dark')).toBe(false);

    media.setDark(true);
    expect(theme.isDark()).toBe(true);
    expect(document.documentElement.classList.contains('theme-dark')).toBe(true);
    expect(localStorage.getItem(THEME_KEY)).toBe('system');
  });

  it('restores the persisted mode on construction', () => {
    localStorage.setItem(THEME_KEY, 'dark');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    theme = TestBed.inject(ThemeService);
    flushEffects();

    expect(theme.mode()).toBe('dark');
    // Media query still reports light — only the stored choice drives this.
    expect(theme.isDark()).toBe(true);
    expect(document.documentElement.classList.contains('theme-dark')).toBe(true);
  });

  it('falls back to system mode for corrupt stored values', () => {
    localStorage.setItem(THEME_KEY, 'midnight-blue');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    theme = TestBed.inject(ThemeService);
    flushEffects();

    expect(theme.mode()).toBe('system');
    expect(theme.isDark()).toBe(false);
    expect(document.documentElement.classList.contains('theme-dark')).toBe(false);
  });

  it('keeps the choice for the session when localStorage writes fail', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    expect(() => theme.setMode('dark')).not.toThrow();
    expect(theme.mode()).toBe('dark');
    flushEffects();
    expect(theme.isDark()).toBe(true);

    setItem.mockRestore();
  });
});
