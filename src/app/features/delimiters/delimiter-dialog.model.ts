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
}
