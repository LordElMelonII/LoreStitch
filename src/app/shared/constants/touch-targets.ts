/**
 * Touch-target policy for interactive elements (M3 accessibility).
 *
 * - `TOUCH_TARGET_MIN` (44px) is the universal minimum floor that every
 *   interactive element — buttons, chips, toggles, list rows, accordion
 *   headers — must meet on ALL viewports.
 * - `TOUCH_TARGET_MOBILE` (48px) is the enhanced target on mobile, i.e.
 *   viewports matching the shell's mobile query in `breakpoints.ts`
 *   (`MOBILE_BREAKPOINT_QUERY`, max-width: 767px).
 *
 * The matching CSS custom properties `--touch-target-min` /
 * `--touch-target-mobile` are defined on `:root` in `src/styles.scss` and
 * must stay in sync with these values.
 */
export const TOUCH_TARGET_MIN = 44;

export const TOUCH_TARGET_MOBILE = 48;
