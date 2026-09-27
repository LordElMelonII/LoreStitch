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
  /**
   * Pre-folded lowercase haystack of every searchable field, built once per
   * entry change by `memoEntryHaystack` in the `items` computed (the
   * identity-keyed memo that composes `entrySearchHaystack`) — the
   * per-keystroke filter scan only ever `includes` over it.
   */
  readonly search: string;
}

/**
 * Re-export only: the fold primitive itself moved to
 * `core/services/entry-memo.ts` (plan 18 D2) — core must not import from
 * features, so the implementation lives core-side next to the per-entry
 * memoization (`memoEntryHaystack`) that now composes it. Behavior and
 * export surface are unchanged for every import site.
 */
export { entrySearchHaystack } from '../../core/services/entry-memo';

/**
 * Case-insensitive containment over a pre-folded haystack. `query` must
 * already be trimmed and lowercased — fold it once per keystroke at the
 * call site, never once per entry. An empty query matches everything;
 * callers keep guarding the empty-query fast path as they do today.
 */
export function matchesQuery(haystack: string, query: string): boolean {
  return haystack.includes(query);
}
