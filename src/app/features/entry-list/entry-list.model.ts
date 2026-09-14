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
}
