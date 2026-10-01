import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MAT_BOTTOM_SHEET_DATA, MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { type ConfirmDialogData } from './confirm-dialog.model';

/** Payload handed to `ConfirmDialog` when a caller opens it with no data (never in-app). */
const EMPTY_DATA: ConfirmDialogData = { title: '', message: '' };

/**
 * Minimal destructive-action confirmation.
 *
 * Dual-container, like the Batch/Delimiter panes: a centered `MatDialog`
 * (tablet/desktop) and a `MatBottomSheet` (phones, `.app-confirm-sheet`)
 * share this template, so both refs and both data tokens are injected
 * optionally and `close()` routes to whichever container is present.
 */
@Component({
  selector: 'app-confirm-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatDialogModule, MatIconModule],
  template: `
    <h2 mat-dialog-title class="title">
      <mat-icon aria-hidden="true" [class.danger]="data.danger">{{ icon }}</mat-icon>
      {{ data.title }}
    </h2>
    <mat-dialog-content>
      <p class="message">{{ data.message }}</p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button matButton type="button" (click)="close(false)">
        {{ data.cancelLabel ?? 'Cancel' }}
      </button>
      <button
        [matButton]="data.danger ? 'outlined' : 'filled'"
        [class.danger-btn]="data.danger"
        type="button"
        (click)="close(true)"
      >
        {{ data.confirmLabel ?? 'Confirm' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .title {
      display: flex;
      align-items: center;
      gap: 8px;

      .danger {
        color: var(--mat-sys-error);
      }
    }

    .message {
      margin: 0;
      font: var(--mat-sys-body-medium);
    }

    .danger-btn {
      color: var(--mat-sys-error);
    }
  `,
})
export class ConfirmDialog {
  /** Ref of the opening container — exactly one of the two is present. */
  private readonly dialogRef = inject(MatDialogRef<ConfirmDialog, boolean>, { optional: true });
  private readonly sheetRef = inject(MatBottomSheetRef<ConfirmDialog, boolean>, { optional: true });

  /** Payload from whichever container opened the pane (canonical at the caller). */
  protected readonly data: ConfirmDialogData =
    (inject(MAT_DIALOG_DATA, { optional: true }) as ConfirmDialogData | null) ??
    (inject(MAT_BOTTOM_SHEET_DATA, { optional: true }) as ConfirmDialogData | null) ??
    EMPTY_DATA;

  /** Title icon ligature (interpolated names land via the subsetter's DYNAMIC_ICONS). */
  protected get icon(): string {
    return this.data.danger ? 'warning' : 'help';
  }

  /** Closes through whichever container opened the pane, carrying the result. */
  protected close(result: boolean): void {
    this.dialogRef?.close(result);
    this.sheetRef?.dismiss(result);
  }
}
