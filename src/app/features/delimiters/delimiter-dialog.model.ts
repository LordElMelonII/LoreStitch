import { type MalformedWrapper } from '../../core/models/delimiters';

/**
 * Payload handed to `DelimiterDialog`, from either container
 * (`ResponsiveOverlayService` keeps `data` canonical across dialog/sheet).
 *
 * The two modes are mutually exclusive:
 * - **Selection mode** (Task 12 §5.2, D2): non-empty `entryIds` — the pane
 *   locks to the checked entries (no Apply-to select) and the caller clears
 *   the selection when the pane closes truthy.
 * - **Editor mode**: `activeEntryId` — the historical entry/all scope select.
 */
export interface DelimiterDialogData {
  /** Selection mode: apply to exactly these checked entries. */
  entryIds?: number[];
  /** Editor mode: the entry under edit (`entry` scope) — `null` allowed. */
  activeEntryId?: number | null;
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
  /**
   * The classified malformed whole-content wrapper in the current content
   * (`<test>…</universe>`, an orphan opener/closer, an unclosed bracket), null
   * when none: well-formed detection and this classification are mutually
   * exclusive, so a row is never both `replacedDelimiter`-hinted and
   * `malformed`-flagged. The row renders a chip and a strip hint from it, and
   * applying strips the shell before the rewrap.
   */
  malformed: MalformedWrapper | null;
}
