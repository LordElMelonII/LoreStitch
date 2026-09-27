/** Minimum pointer travel before a tab-strip gesture counts as a drag. */
export const TAB_STRIP_DRAG_SLOP_PX = 8;

/**
 * Trailing idle-commit delay for `entrySliceSignal` text/extension-slice
 * writes (plan 18 D1): continuous typing commits to the workspace once, this
 * long after the last keystroke, so a keystroke costs one form write and one
 * textarea render — O(1) in book size. A pending draft flushes on timer
 * elapse, `DestroyRef` teardown, or external entry replacement (the merge
 * rule in `entrySliceSignal`).
 */
export const EDIT_COMMIT_DEBOUNCE_MS = 300;
