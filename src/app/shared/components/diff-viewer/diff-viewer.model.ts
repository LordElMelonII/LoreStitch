/** Rendering layout of a diff: stacked lines or side-by-side rows. */
export type DiffMode = 'unified' | 'split';

/** One classified line of a unified diff. */
export interface DiffLine {
  type: 'added' | 'removed' | 'context';
  text: string;
}

/** A pair of rows for side-by-side rendering; either side may be empty. */
export interface SplitRow {
  left: DiffLine | null;
  right: DiffLine | null;
}
