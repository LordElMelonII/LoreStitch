import type { WiTriggerState } from '../../core/models/lorebook.model';

/** Flattened view model of one row in the entries sidebar. */
export interface EntryListItem {
  id: number;
  title: string;
  keys: string[];
  enabled: boolean;
  state: WiTriggerState;
  dirty: boolean;
  content: string;
  /** Estimated tokens the entry contributes when activated. */
  tokens: number;
  /** Author-assigned LoreStitch tags (see `entryTags`). */
  tags: string[];
}

/**
 * Pre-folds an entry's searchable text into one lowercase haystack:
 * `[title, ...keys, ...tags, content]` joined on `'\n'` and lowercased once
 * per entry change, so the per-keystroke filter scan becomes a
 * zero-allocation `includes` instead of re-lowercasing every field —
 * including a fresh copy of the full `content` — for each keystroke
 * (Task 07: search responsiveness).
 *
 * Equivalence with the previous per-field checks (`title || keys || tags ||
 * content`, each `toLowerCase().includes(query)`): the sidebar filter reads
 * its query from a single-line text input, and the WHATWG input
 * sanitization algorithm strips newlines from single-line values, so a
 * query can never contain the `'\n'` separator — every query the old scan
 * matched lies wholly inside one field of the join, and no cross-field
 * query can appear.
 *
 * Memory trade: the joined copy roughly doubles the text held for the open
 * book (one extra content-sized string per entry). Documented fallback if
 * that bites on enormous books: per-item memoized folding keyed on entry
 * identity — deliberately not built now
 * (next_tasks/07-search-responsiveness.md §7.2).
 */
export function entrySearchHaystack(
  title: string,
  keys: readonly string[],
  tags: readonly string[],
  content: string,
): string {
  return [title, ...keys, ...tags, content].join('\n').toLowerCase();
}

/**
 * Case-insensitive containment over a pre-folded haystack. `query` must
 * already be trimmed and lowercased — fold it once per keystroke at the
 * call site, never once per entry. An empty query matches everything;
 * callers keep guarding the empty-query fast path as they do today.
 */
export function matchesQuery(haystack: string, query: string): boolean {
  return haystack.includes(query);
}
