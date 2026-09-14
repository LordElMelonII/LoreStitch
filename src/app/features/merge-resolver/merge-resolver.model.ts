import type { CharacterBook, CharacterBookEntry } from '../../core/models/lorebook.model';

/** What to do with one incoming entry during a merge. */
export type MergeAction = 'import' | 'overwrite' | 'skip';

/** Payload handed to `MergeResolverDialog`. */
export interface MergeDialogData {
  incoming: CharacterBook;
  sourceName: string;
  /** Diff layout; mobile shells pass 'unified'. */
  mode?: 'unified' | 'split';
}

/** Result returned when the user applies a merge. */
export interface MergeOutcome {
  entries: CharacterBookEntry[];
  imported: number;
  overwritten: number;
  skipped: number;
}

/** One picker row: an incoming entry and the local entry it clashes with. */
export interface MergeRow {
  incoming: CharacterBookEntry;
  local: CharacterBookEntry | null;
  identical: boolean;
}

/** Running tally of chosen actions, rendered on the apply button. */
export interface MergePendingCounts {
  import: number;
  overwrite: number;
  skip: number;
}
