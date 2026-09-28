/** Minimum pointer travel before a tab-strip gesture counts as a drag. */
export const TAB_STRIP_DRAG_SLOP_PX = 8;

/**
 * Trailing window used to estimate a tab-strip swipe's release velocity:
 * only move samples this recent (in ms) vote, so a fast gesture followed by a
 * held-still finger does not fling on stale speed.
 */
export const TAB_STRIP_FLING_VELOCITY_WINDOW_MS = 100;

/**
 * Finger speed (px/ms) a release must exceed to start a momentum fling.
 * Slower releases read as deliberate positioning and stop dead, exactly like
 * a wheel scroll of the strip.
 */
export const TAB_STRIP_FLING_MIN_START_PX_PER_MS = 0.15;

/** Residual speed (px/ms) at which a running fling has visibly settled. */
export const TAB_STRIP_FLING_STOP_PX_PER_MS = 0.02;

/**
 * Velocity decay time constant (ms) of the release fling: every frame scales
 * the speed by exp(-dt/τ). 225 ms glides between iOS's long coast and
 * Android's brisk settle.
 */
export const TAB_STRIP_FLING_DECAY_MS = 225;

/**
 * Trailing idle-commit delay for `entrySliceSignal` text/extension-slice
 * writes (plan 18 D1): continuous typing commits to the workspace once, this
 * long after the last keystroke, so a keystroke costs one form write and one
 * textarea render — O(1) in book size. A pending draft flushes on timer
 * elapse, `DestroyRef` teardown, or external entry replacement (the merge
 * rule in `entrySliceSignal`).
 */
export const EDIT_COMMIT_DEBOUNCE_MS = 300;
