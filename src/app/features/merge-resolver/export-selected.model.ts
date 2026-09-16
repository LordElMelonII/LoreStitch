import { entryTitle, type CharacterBookEntry } from '../../core/models/lorebook.model';

/**
 * Pure selection/dependency logic for the "Export Selected Entries as
 * Lorebook" flow. Kept framework-free so it is unit-testable in isolation.
 */

/** Export file format offered by the dialog. */
export type ExportSelectionFormat = 'st_native' | 'character_book';

/** Result the dialog returns to its opener. */
export interface ExportSelection {
  entryIds: number[];
  title: string;
  format: ExportSelectionFormat;
}

/**
 * One selective-trigger dependency found in the selection: an exported
 * entry's secondary key matches the primary key of another entry that is
 * NOT part of the export — the split-off book loses that link.
 */
export interface ExportDependencyWarning {
  entryId: number;
  entryTitle: string;
  /** The secondary key that references the unexported entry. */
  key: string;
  /** Title of one (the first) unexported target entry. */
  targetTitle: string;
  /** How many unexported entries the key points at. */
  targetCount: number;
}

function normalizeKey(key: string): string {
  return key.trim().toLowerCase();
}

/**
 * Cross-references the selection against the full book: for every selected
 * entry carrying secondary keys, a secondary key that resolves to another
 * entry's primary key which is not itself selected yields a warning.
 * (SillyTavern treats the presence of secondary keys as selective logic, so
 * the check does not require the `selective` flag.)
 *
 * Keys that match nothing in the book are ignored — they are presumably
 * meant to match chat text, not other entries.
 */
export function checkExportDependencies(
  allEntries: readonly CharacterBookEntry[],
  selectedIds: ReadonlySet<number>,
): ExportDependencyWarning[] {
  // Primary-key index over the whole book (a key can be shared).
  const byPrimaryKey = new Map<string, CharacterBookEntry[]>();
  for (const entry of allEntries) {
    for (const key of entry.keys ?? []) {
      const normalized = normalizeKey(key);
      if (!normalized) {
        continue;
      }
      const bucket = byPrimaryKey.get(normalized);
      if (bucket) {
        bucket.push(entry);
      } else {
        byPrimaryKey.set(normalized, [entry]);
      }
    }
  }

  const warnings: ExportDependencyWarning[] = [];
  const seen = new Set<string>();
  for (const entry of allEntries) {
    if (entry.id === undefined || !selectedIds.has(entry.id)) {
      continue;
    }
    for (const key of entry.secondary_keys ?? []) {
      const normalized = normalizeKey(key);
      if (!normalized) {
        continue;
      }
      const targets = (byPrimaryKey.get(normalized) ?? []).filter(
        (target) =>
          target.id !== entry.id && target.id !== undefined && !selectedIds.has(target.id),
      );
      const firstTarget = targets[0];
      if (!firstTarget) {
        continue;
      }
      const dedupeKey = `${entry.id}::${normalized}`;
      if (seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);
      warnings.push({
        entryId: entry.id,
        entryTitle: entryTitle(entry),
        key,
        targetTitle: entryTitle(firstTarget),
        targetCount: targets.length,
      });
    }
  }
  return warnings;
}
