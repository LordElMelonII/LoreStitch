import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  SHORTCUTS_HELP,
  type ShortcutHelpEntry,
} from '../../../core/models/shortcut-map';

/** One titled group of the help catalog. */
interface ShortcutHelpGroup {
  readonly title: string;
  readonly entries: readonly ShortcutHelpEntry[];
}

/**
 * The keyboard-shortcuts help pane (Task 10 §3.6): the resolver's own
 * `SHORTCUTS_HELP` catalog, rendered — no second table to drift. Dual
 * container like the About/Batch panes: a centered dialog (tablet/desktop)
 * and a bottom sheet (phones, `.app-shortcuts-sheet`) share this template,
 * so both refs are injected optionally and `close()` routes to whichever
 * container is present. Presentational only: no data injection, nothing to
 * apply — Escape (CDK default) and the header close button are the exits.
 */
@Component({
  selector: 'app-shortcuts-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatDialogModule, MatIconModule, MatTooltipModule],
  templateUrl: './shortcuts-dialog.html',
  styleUrl: './shortcuts-dialog.scss',
})
export class ShortcutsDialog {
  /** Ref of the opening container — exactly one of the two is present. */
  private readonly dialogRef = inject(MatDialogRef<ShortcutsDialog, void>, { optional: true });
  private readonly sheetRef = inject(MatBottomSheetRef<ShortcutsDialog, void>, {
    optional: true,
  });

  /**
   * The catalog grouped for display, in table order within each group:
   * chords that fire anywhere under "Everywhere", the entry-list-only
   * chords under "In the entry list".
   */
  protected readonly groups = computed<ShortcutHelpGroup[]>(() => [
    { title: 'Everywhere', entries: SHORTCUTS_HELP.filter((entry) => entry.group === 'global') },
    { title: 'In the entry list', entries: SHORTCUTS_HELP.filter((entry) => entry.group === 'list') },
  ]);

  /** Closes the pane through whichever container opened it. */
  protected close(): void {
    this.dialogRef?.close();
    this.sheetRef?.dismiss();
  }
}
