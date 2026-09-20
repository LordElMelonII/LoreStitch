/**
 * Debounce window shared by both search surfaces — the entries sidebar
 * filter (entry-list) and the Search & Replace dialog — so typing settles
 * at the same cadence wherever the user searches. The expensive scan runs
 * at most once per window instead of once per keystroke; the input itself
 * stays immediate, so typing never feels laggy.
 *
 * Documented fallback, NOT built: a length-based bypass that scans
 * immediately while the book is small (under ~500 entries) — see
 * next_tasks/07-search-responsiveness.md §7.1 — to be revisited only if
 * the settle ever feels slow on small books.
 */
export const SEARCH_DEBOUNCE_MS = 200;
