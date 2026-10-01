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
 * Case-insensitive containment over a pre-folded haystack. `query` must
 * already be trimmed and lowercased — fold it once per keystroke at the
 * call site, never once per entry. An empty query matches everything;
 * callers keep guarding the empty-query fast path as they do today.
 */
export function matchesQuery(haystack: string, query: string): boolean {
  return haystack.includes(query);
}

/**
 * Range-selection math for one gesture (task 20 D4): every id in the
 * inclusive slice of `view` between `fromId` and `toId` — either direction —
 * is added (`target: true`) or removed (`target: false`); ids outside the
 * slice are preserved. Computed over the filtered view order, never the DOM,
 * so rows outside the rendered virtual window are included. When either
 * endpoint id is not in `view`, `current` is returned by reference: the
 * component owns the degradation decision (plain single toggle of the
 * gesture row), and the by-reference result is what signals it.
 */
export function applyRangeSelection(
  current: ReadonlySet<number>,
  view: EntryListItem[],
  fromId: number,
  toId: number,
  target: boolean,
): ReadonlySet<number> {
  const from = view.findIndex((item) => item.id === fromId);
  const to = view.findIndex((item) => item.id === toId);
  if (from < 0 || to < 0) {
    return current;
  }
  const next = new Set(current);
  for (let i = Math.min(from, to); i <= Math.max(from, to); i += 1) {
    const id = view[i]?.id;
    if (id !== undefined) {
      if (target) {
        next.add(id);
      } else {
        next.delete(id);
      }
    }
  }
  return next;
}
