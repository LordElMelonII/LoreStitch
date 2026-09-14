import type { CharacterBookEntry } from '../../core/models/lorebook.model';

/**
 * View models and structural types shared across the entry editor feature.
 * Nothing here reaches the DOM — this file is pure typing so components and
 * the update service agree on shapes without importing each other.
 */

/** One open editor tab in the strip (label + close/dirty state). */
export interface TabItem {
  id: number;
  title: string;
  dirty: boolean;
}

/**
 * The slice of `MatTabGroup`'s internal header the custom tab-strip scrolling
 * (`scrollTabStripOnWheel`, `TabStripDragScroller`) needs. A structural type
 * so tests can pass plain stand-ins.
 */
export interface ScrollableTabHeader {
  scrollDistance: number;
}

/** The two entry fields that hold key lists. */
export type KeyListField = 'keys' | 'secondary_keys';

/** Fields a tab section may edit inline via double-click chip editing. */
export interface KeyEditTarget {
  field: KeyListField;
  index: number;
}

/** Convenience alias for template lookups of the entry under edit. */
export type EntryLookup = (id: number) => CharacterBookEntry | undefined;
