import { Service, computed, inject, signal } from '@angular/core';
import { BreakpointObserver } from '@angular/cdk/layout';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import {
  DESKTOP_BREAKPOINT_QUERY,
  MOBILE_BREAKPOINT_QUERY,
  TABLET_BREAKPOINT_QUERY,
  ViewportClass,
} from '../constants/breakpoints';

/**
 * Studio-wide layout state and the single source of viewport truth: the
 * shell, the topbar, the project actions and the entry options accordion all
 * read `viewport`/`isMobile`/`isDesktop` from here instead of observing media
 * queries on their own. `BreakpointObserver` may therefore be injected
 * nowhere else.
 *
 * Focus mode constrains the editor column to a reading-friendly width; it is
 * a desktop-only affordance, so the shell clears the flag whenever the
 * viewport leaves the desktop class.
 */
@Service()
export class LayoutService {
  private readonly breakpoints = inject(BreakpointObserver);

  /**
   * The active responsive window class: mobile (< 768px), tablet
   * (768px–1279px) or desktop (>= 1280px). Defaults to desktop when no query
   * matches (e.g. test environments without matchMedia).
   */
  readonly viewport = toSignal(
    this.breakpoints
      .observe([MOBILE_BREAKPOINT_QUERY, TABLET_BREAKPOINT_QUERY, DESKTOP_BREAKPOINT_QUERY])
      .pipe(
        map(({ breakpoints }): ViewportClass =>
          breakpoints[MOBILE_BREAKPOINT_QUERY]
            ? 'mobile'
            : breakpoints[TABLET_BREAKPOINT_QUERY]
              ? 'tablet'
              : 'desktop',
        ),
      ),
    { initialValue: 'desktop' },
  );

  /** Whether the viewport is the compact phone class (< 768px). */
  readonly isMobile = computed(() => this.viewport() === 'mobile');

  /** Whether the viewport is the desktop class (>= 1280px). */
  readonly isDesktop = computed(() => this.viewport() === 'desktop');

  /** Whether the editor area is narrowed for easier reading. */
  readonly focusMode = signal(false);

  toggleFocusMode(): void {
    this.focusMode.update((on) => !on);
  }
}
