/**
 * Responsive window classes for the shell. Both the shell (`App`), the
 * options accordion and the project actions picker key responsive behavior
 * off them, so the media queries live in exactly one place.
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
