import { Service, effect, signal } from '@angular/core';

export type ThemeMode = 'system' | 'light' | 'dark';

const THEME_KEY = 'lorestitch-theme';

/**
 * Theme switcher for the two M3 schemes defined in styles.scss:
 * light = azure-blue, dark = cyan-orange (`theme-dark` class on <html>).
 * `system` follows the OS `prefers-color-scheme` and reacts to changes live.
 */
@Service()
export class ThemeService {
  private readonly media = window.matchMedia('(prefers-color-scheme: dark)');

  /** The stored user preference; `system` (the default) follows the OS. */
  readonly mode = signal<ThemeMode>(this.restore());

  /** True while the dark (cyan-orange) scheme is active. */
  readonly isDark = signal(this.effectiveDark());

  constructor() {
    this.media.addEventListener('change', () => this.apply());
    effect(() => this.apply());
  }

  setMode(mode: ThemeMode): void {
    this.mode.set(mode);
    try {
      localStorage.setItem(THEME_KEY, mode);
    } catch {
      // Storage unavailable (private mode etc.) — the choice lasts the session.
    }
  }

  private restore(): ThemeMode {
    try {
      const stored = localStorage.getItem(THEME_KEY);
      if (stored === 'light' || stored === 'dark' || stored === 'system') {
        return stored;
      }
    } catch {
      // Fall through to the default.
    }
    return 'system';
  }

  private effectiveDark(): boolean {
    const mode = this.mode();
    return mode === 'dark' || (mode === 'system' && this.media.matches);
  }

  private apply(): void {
    const dark = this.effectiveDark();
    document.documentElement.classList.toggle('theme-dark', dark);
    this.isDark.set(dark);
  }
}
