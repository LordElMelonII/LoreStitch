/**
 * Book schema validation — the export contract for `CharacterBook` (Task 09
 * §3.1). LoreStitch's import guards (`isCharacterBook`, `isSillyTavernWorldInfo`)
 * only enforce the fields the editor indexes, so a third-party file can carry a
 * book whose runtime values lie about their types (a string `id`, a `NaN`
 * `insertion_order`) into the workspace — and today's exporters would write
 * that malformation straight to disk: the ST native export is a uid-keyed bag
 * (`entries[String(entry.id)] = …`, lorebook.model.ts), so two entries sharing
 * one id silently collapse into a single entry on SillyTavern's parse.
 *
 * `validateBook` is the read-only pre-flight check every book-carrying export
 * runs before serialization (and the import wiring reuses for its repair
 * offer). It validates ONLY what the exporters and SillyTavern's own parsing
 * index — nothing else:
 *
 * - `position` is deliberately NOT a rule: `entryStPosition` coerces legacy
 *   values and `toSpecCompliantBook` collapses them to the spec-legal strings,
 *   so validating it would reject books that export perfectly.
 * - `extensions` and unknown vendor keys are never inspected beyond the plain
 *   object shape. An unknown key can never make a book invalid — a rule that
 *   rejects one is a bug (plan 09 risk 1).
 *
 * Null handling of the "when present" fields mirrors the consumers on the
 * export path — a `null` counts as absent (legal) exactly where every
 * converter explicitly nullish-handles the field, and as a defect where a
 * consumer takes the value verbatim (world-info.js:5511/:5516/:5548):
 *
 * - `secondary_keys: null` — LEGAL. SillyTavern's own V2 conversion
 *   nullish-handles it (`entry.secondary_keys || []`, world-info.js:5511) and
 *   so does the native export (`entry.secondary_keys ?? []`); flagging it
 *   would false-positive on hand-authored books that parse fine.
 * - `extensions: null` — LEGAL, same shape (`?? {}` on both sides,
 *   world-info.js:5548); both LoreStitch exporters substitute cleanly.
 * - `insertion_order: null` — DEFECT. SillyTavern's conversion takes it
 *   verbatim with no fallback (`order: entry.insertion_order`,
 *   world-info.js:5516) and sorts on it arithmetically (worldinfo.md:75-139);
 *   the exported V2 bytes would carry a `null` where the schema documents a
 *   number. The repair default (100) is exactly what `normalizeImportedBook`
 *   and the native export already write for non-numbers.
 * - `priority: null` — DEFECT (checkpoint 09-1 policy call). Nothing consumes
 *   the field, but the documented unset is `undefined` (plan 09 rule 8;
 *   `createEmptyEntry` / the native conversion write `priority: undefined`),
 *   so a present `null` would serialize as a spec violation on the V2 path.
 *   The repair unsets it — zero data risk.
 *
 * An ABSENT `id` is also a defect (rule 2: every id a finite number): the
 * native export index-fills it, but `extractSubBook` silently drops id-less
 * entries from split exports and `WorkspaceService.updateEntry` patches every
 * id match — the defect is real even though the collapse is not.
 *
 * Total, read-only, never throws: malformed books are the input this module
 * exists for, so every field is read defensively through `unknown` narrowing
 * and no entry shape is assumed. Result order is stable: book order (entry
 * iteration order), then a fixed kind order per entry.
 *
 * The rule set is indexed against the vendored SillyTavern snapshot
 * (sillytaver-world-info-doc/world-info.js — the V2→native conversion and the
 * scan loop's uid handling — and worldinfo.md). A SillyTavern update requires
 * a re-read of the snapshot and a re-grounding of this module's rule set.
 */

import { CharacterBook, isJsonObject } from './lorebook.model';

/** Every structural defect the pre-flight check can report. */
export type BookDefectKind =
  | 'entry-id-not-finite'
  | 'entry-id-duplicate'
  | 'entry-content-not-string'
  | 'entry-keys-not-string-array'
  | 'entry-secondary-keys-not-string-array'
  | 'entry-insertion-order-not-finite'
  | 'entry-priority-not-finite'
  | 'entry-extensions-not-object'
  | 'book-entries-not-array';

/** One validation finding. Pure data — the dialog renders it, the repair planner consumes the kinds. */
export interface BookDefect {
  readonly kind: BookDefectKind;
  /**
   * The entry's id as found when it is a number (`NaN`/`±Infinity` included);
   * `null` for book-level findings and for entries whose id is not a number
   * (a string id like `"7"` cannot honestly fill a `number` field — the
   * `entryTitle` carries the identification instead).
   */
  readonly entryId: number | null;
  /** The entry's display title (comment, then name — the `entryTitle` convention), `null` when neither is a usable string. */
  readonly entryTitle: string | null;
}

/**
 * Validates a book against the export contract. Total and read-only: any
 * input — including `null`/`undefined` and runtime values that contradict the
 * `CharacterBook` types — yields a defect list, never a throw. An empty list
 * means the book exports byte-identically to the pre-task behavior.
 */
export function validateBook(book: CharacterBook): BookDefect[] {
  // Read `entries` defensively: the parameter lies about its type by contract.
  const entries: unknown = (book as unknown as Record<string, unknown> | null | undefined)?.[
    'entries'
  ];
  if (!Array.isArray(entries)) {
    // The collection itself is malformed — there is nothing else to check.
    return [{ kind: 'book-entries-not-array', entryId: null, entryTitle: null }];
  }

  // Pass 1 — canonical id keys for duplicate detection. The native export keys
  // entries by `String(id)`, so that is the equality that collapses: `7` and
  // `"7"` collide, while nullish ids are index-filled downstream and can never
  // collide (they are still flagged by rule 2 below).
  const idKeyCounts = new Map<string, number>();
  for (const entry of entries) {
    if (!isJsonObject(entry)) {
      continue;
    }
    const key = canonicalIdKey(entry['id']);
    if (key !== null) {
      idKeyCounts.set(key, (idKeyCounts.get(key) ?? 0) + 1);
    }
  }
  const duplicateKeys = new Set(
    [...idKeyCounts].filter(([, count]) => count > 1).map(([key]) => key),
  );

  // Pass 2 — per-entry checks in book order; a fixed kind order per entry.
  const defects: BookDefect[] = [];
  for (const entry of entries) {
    if (!isJsonObject(entry)) {
      // A non-object member makes the entries collection itself malformed —
      // reported under the book-level kind (no entry-level kind exists for it
      // in the plan's fixed union, and no single-field repair could fabricate
      // an entry): unfixable, hard-block territory.
      defects.push({ kind: 'book-entries-not-array', entryId: null, entryTitle: null });
      continue;
    }
    const title = defectTitle(entry);
    const entryId = typeof entry['id'] === 'number' ? entry['id'] : null;

    // Rule 2 — every id a finite number (V2 `id` / ST `uid`). Absent, null,
    // string, NaN and ±Infinity all fail; a numeric id is reported as found.
    if (typeof entry['id'] !== 'number' || !Number.isFinite(entry['id'])) {
      defects.push({ kind: 'entry-id-not-finite', entryId, entryTitle: title });
    }
    // Rule 3 — ids unique across the book (the uid-keyed bag collapses
    // duplicates on SillyTavern's parse). Both positions report.
    const key = canonicalIdKey(entry['id']);
    if (key !== null && duplicateKeys.has(key)) {
      defects.push({ kind: 'entry-id-duplicate', entryId, entryTitle: title });
    }
    // Rule 4 — content a string (both formats inject it into the prompt).
    if (typeof entry['content'] !== 'string') {
      defects.push({ kind: 'entry-content-not-string', entryId, entryTitle: title });
    }
    // Rule 5 — keys a string array (the keyword scan iterates it).
    if (!isStringArrayValue(entry['keys'])) {
      defects.push({ kind: 'entry-keys-not-string-array', entryId, entryTitle: title });
    }
    // Rule 6 — secondary_keys a string array when present (absent-or-null legal,
    // see module comment).
    const secondary = entry['secondary_keys'];
    if (secondary !== undefined && secondary !== null && !isStringArrayValue(secondary)) {
      defects.push({ kind: 'entry-secondary-keys-not-string-array', entryId, entryTitle: title });
    }
    // Rule 7 — insertion_order finite when present (absent legal; null/non-number/
    // NaN/±Infinity defect — see module comment).
    const order = entry['insertion_order'];
    if (order !== undefined && !(typeof order === 'number' && Number.isFinite(order))) {
      defects.push({ kind: 'entry-insertion-order-not-finite', entryId, entryTitle: title });
    }
    // Rule 8 — priority finite when present (undefined legal — the documented
    // unset; null and other non-numbers defect).
    const priority = entry['priority'];
    if (priority !== undefined && !(typeof priority === 'number' && Number.isFinite(priority))) {
      defects.push({ kind: 'entry-priority-not-finite', entryId, entryTitle: title });
    }
    // Rule 9 — extensions a plain object when present (absent-or-null legal;
    // arrays/strings/numbers defect).
    const extensions = entry['extensions'];
    if (extensions !== undefined && extensions !== null && !isJsonObject(extensions)) {
      defects.push({ kind: 'entry-extensions-not-object', entryId, entryTitle: title });
    }
  }
  return defects;
}

/**
 * The duplicate-detection key: `String(id)` — exactly the key the native
 * export's uid bag uses, so this catches every value pair that would collapse
 * on SillyTavern's parse. Nullish ids (index-filled downstream) and absent ids
 * never join a group; a value `String()` cannot even render (a symbol, an
 * object with a throwing `toString`) shares one throwaway key so such entries
 * still report as mutually duplicate rather than slipping through.
 */
function canonicalIdKey(id: unknown): string | null {
  if (id === undefined || id === null) {
    return null;
  }
  try {
    return String(id);
  } catch {
    return '(unstringable)';
  }
}

/** A runtime string array: an array whose every member is a string. */
function isStringArrayValue(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/**
 * The entry's display title for dialog lines, read defensively (the shared
 * `entryTitle` falls back to `keys`, which rule 5 may have just declared
 * malformed — here only comment/name qualify, `null` when neither does).
 */
function defectTitle(entry: Record<string, unknown>): string | null {
  const comment = entry['comment'];
  if (typeof comment === 'string' && comment.trim() !== '') {
    return comment;
  }
  const name = entry['name'];
  if (typeof name === 'string' && name.trim() !== '') {
    return name;
  }
  return null;
}
