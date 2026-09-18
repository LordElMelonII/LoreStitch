/**
 * Responsive window classes for the shell. Both the shell (`App`), the
 * options accordion and the project actions picker key responsive behavior
 * off them, so the media queries live in exactly one place.
 *
 * The app intentionally runs on TWO breakpoint systems:
 *
 * - Shell/sheet breakpoint, < 768px (`MOBILE_BREAKPOINT_QUERY`): the sidenav
 *   containers switch to `over` mode and action dialogs render as
 *   `MatBottomSheet`s instead of `MatDialog`s. The derived viewport state
 *   lives in `LayoutService` — the only allowed `BreakpointObserver`
 *   consumer — so every component reads the same signal.
 * - Material compact-dialog breakpoint, <= 599px: Angular Material's
 *   compact window size, where the global `.app-compact-fullscreen-dialog`
 *   rules (src/styles.scss) stretch dialog panes edge-to-edge full-screen.
 *   This one is CSS-only and must NOT be re-derived in TypeScript.
 *
 * - Compact phone (< 768px): both drawers overlay, closed by default.
 * - Tablet (768px–1279px): entries stay docked; history overlays.
 * - Desktop (>= 1280px): both panels dock side-by-side.
 */
export const MOBILE_BREAKPOINT_QUERY = '(max-width: 767px)';
export const TABLET_BREAKPOINT_QUERY = '(min-width: 768px) and (max-width: 1279px)';
export const DESKTOP_BREAKPOINT_QUERY = '(min-width: 1280px)';

/** Named responsive window class derived from the queries above. */
export type ViewportClass = 'mobile' | 'tablet' | 'desktop';
