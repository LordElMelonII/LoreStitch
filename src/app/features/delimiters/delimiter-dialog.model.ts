/** Payload handed to `DelimiterDialog`. */
export interface DelimiterDialogData {
  activeEntryId: number | null;
}

/** Whether the delimiter operation touches one entry or the whole book. */
export type DelimiterScope = 'entry' | 'all';

/** One live preview row: the entry's current content vs. the rewrapped one. */
export interface EntryPreview {
  entryId: number;
  title: string;
  current: string;
  next: string;
  changed: boolean;
  /**
   * The target is empty/whitespace-only, so the Phase-1 contract makes the
   * rewrap a no-op: the row can never change and is excluded from writes.
   */
  blank: boolean;
  /** Estimated token change: `estimateTokens(next) - estimateTokens(current)`. */
  tokenDelta: number;
  /**
   * Label of the delimiter detected in the current content (`<TEAFsa>`,
   * `[Old=…]`, `---`) when applying will strip it: a detected whole-content
   * wrapper is replaced by the target style — or removed by `none` —
   * regardless of its name. `null` when nothing recognized is stripped: no
   * wrapper detected, the row is a fixed point, or a trailing `---` kept as
   * payload under a tag/bracket target. The row renders a hint from it so
   * the replacement is visible before anything is written.
   */
  replacedDelimiter: string | null;
}
