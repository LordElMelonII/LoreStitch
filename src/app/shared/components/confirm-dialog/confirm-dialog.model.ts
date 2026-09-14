/** Payload for the generic destructive-action confirmation dialog. */
export interface ConfirmDialogData {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
}
