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
   * The current content carries a tag/bracket wrapper whose name matches none
   * of the entry's expected wrapper names. Applying the target style then
   * wraps additively around it (or, for `none`, leaves it untouched) instead
   * of stripping it — the row renders a hint so the user knows why.
   */
  unrecognizedName: boolean;
}
