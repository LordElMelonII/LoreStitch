/** Payload for the generic destructive-action confirmation dialog. */
export interface ConfirmDialogData {
  title: string;
  message: string;
  confirmLabel?: string;
  /** Dismissal label; defaults to "Cancel" (session lock's "Stay read-only"). */
  cancelLabel?: string;
  danger?: boolean;
}
