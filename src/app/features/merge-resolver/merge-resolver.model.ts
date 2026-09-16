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

function normalizeKey(key: string): string {
  return key.trim().toLowerCase();
}

function keySet(entry: CharacterBookEntry): Set<string> {
  return new Set((entry.keys ?? []).map(normalizeKey).filter((k) => k.length > 0));
}

function normalizeName(entry: CharacterBookEntry): string {
  // Comments are always present on normalized entries ('' default), so the
  // name is a genuine fallback rather than dead code.
  const title = (entry.comment ?? '').trim() || (entry.name ?? '').trim();
  return title.toLowerCase();
}

/**
 * True when the incoming entry carries the same lore as the local one —
 * same keys (normalized: trimmed, case-folded, order-insensitive) and
 * byte-identical content — so the merge can default to skipping it instead
 * of surfacing a needless conflict.
 */
export function mergeEntriesIdentical(
  local: CharacterBookEntry,
  incoming: CharacterBookEntry,
): boolean {
  const localKeys = (local.keys ?? []).map(normalizeKey).sort().join('\u0000');
  const incomingKeys = (incoming.keys ?? []).map(normalizeKey).sort().join('\u0000');
  return localKeys === incomingKeys && local.content === incoming.content;
}

/**
 * Finds the local entry an incoming one collides with, by identity in
 * escalating order:
 * 1. **uid** — same entry id (SillyTavern's primary identity),
 * 2. **activation keys** — overlapping normalized primary keys,
 * 3. **name** — identical normalized comment/name (title collision).
 *
 * Returns null when the incoming entry is new to this book.
 */
export function findMergeMatch(
  incoming: CharacterBookEntry,
  current: readonly CharacterBookEntry[],
): CharacterBookEntry | null {
  if (incoming.id !== undefined) {
    const byId = current.find((e) => e.id === incoming.id);
    if (byId) {
      return byId;
    }
  }

  const incomingKeys = keySet(incoming);
  if (incomingKeys.size) {
    const byKey = current.find((local) => {
      const localKeys = keySet(local);
      for (const key of incomingKeys) {
        if (localKeys.has(key)) {
          return true;
        }
      }
      return false;
    });
    if (byKey) {
      return byKey;
    }
  }

  const incomingName = normalizeName(incoming);
  if (incomingName) {
    return current.find((local) => normalizeName(local) === incomingName) ?? null;
  }
  return null;
}
