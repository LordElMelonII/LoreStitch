import { type BookDefect } from '../../../core/models/book-schema';
import { type BookRepair } from '../../../core/models/book-repair';

/**
 * Payload for the guided book-repair pane (plan 09 §3.3), canonical at the
 * `ResponsiveOverlayService.openResponsive` call site and injected into the
 * component by whichever container opened it (`MAT_DIALOG_DATA` or
 * `MAT_BOTTOM_SHEET_DATA`).
 */
export interface BookRepairDialogData {
  /** Which flow was blocked — the context decides the approved copy and actions. */
  context: 'import' | 'export';
  /**
   * The one-click plan for the fixable defects. `null` selects the hard-block
   * variant: the defect list renders without a repair offer and the pane has
   * a single Close action.
   */
  repair: BookRepair | null;
  /** The unfiltered validation findings; the block variant lists them as rows. */
  defects: BookDefect[];
  /**
   * Snapshot hard-block attribution (`"<message> (<id7>)"`, plan 09 §3.5) —
   * shown verbatim when present. Only `exportProject`'s snapshot block sets it.
   */
  source?: string;
  /** The book's title — context for the devtools detail line, never message copy. */
  bookTitle: string;
}
