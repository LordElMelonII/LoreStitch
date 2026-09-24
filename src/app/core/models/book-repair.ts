/**
 * Guided book repair — the change-list planner behind the repair dialog
 * (Task 09 §3.2). `validateBook` (book-schema.ts) flags the defects; this
 * module plans the ONE-CLICK fix the user consents to at the dialog: every
 * change is reported before it is applied, and the plan is a pure value —
 * applying nothing until the caller takes `repair.book`.
 *
 * Repair policy (final say at checkpoint 09-1):
 *
 * - Duplicate ids keep the FIRST occurrence in book order; every later
 *   occurrence is renumbered with a fresh sequential id starting at
 *   `max(finite ids across the book) + 1` (0 when the book has none, matching
 *   `normalizeImportedBook`'s allocator). The max ignores non-finite ids, and
 *   counts every finite id — including ones about to be renumbered — so no
 *   fresh id can collide with anything.
 * - `coerce-id` wins over `reassign-id` when the parsed number is free: a
 *   string id `"7"` becomes the number `7` unless another entry already holds
 *   that identity. Freeness is judged on the post-coercion key `String(id)` —
 *   exactly the key the native export's uid bag (`entries[String(uid)]`,
 *   lorebook.model.ts) and SillyTavern's own V2 conversion
 *   (`result.entries[entry.id]`, world-info.js:5507) collapse on.
 * - Non-finite `insertion_order` defaults to 100 — `normalizeImportedBook`'s
 *   own default and what the native export writes for a nullish one.
 * - Non-finite `priority` is unset to `undefined` — the documented unset, the
 *   value `createEmptyEntry` and the native conversion write (JSON.stringify
 *   drops the key either way; the field is assigned, not deleted, to match
 *   the in-house entry shape).
 * - Unfixable defects (`book-entries-not-array`, `entry-content-not-string`,
 *   `entry-keys-not-string-array`, `entry-secondary-keys-not-string-array`,
 *   `entry-extensions-not-object`) admit no repair: their presence makes the
 *   whole plan `null` — hard-block territory, even when fixable defects
 *   accompany them.
 *
 * Lossless by construction: the repaired book is a `structuredClone` of the
 * input (which preserves key order and every unknown vendor key), and each
 * change writes EXACTLY one flagged field on the clone — `extensions` bags,
 * extra keys and everything untouched ride along verbatim. Entries are never
 * rebuilt from an allowlist. The input is never mutated.
 *
 * Idempotent by contract: `validateBook(repair.book)` returns `[]` and
 * planning over the repaired book again returns `null`.
 *
 * Total and deterministic: `null` for empty defect lists, degenerate inputs,
 * books whose tree cannot be structured-cloned (function/symbol values are
 * not losslessly repairable), and any request with no actionable changes —
 * never a throw. The result order is stable: book order, with an entry's own
 * changes in kind order (id, insertion order, priority).
 *
 * The policy is indexed against the vendored SillyTavern snapshot
 * (sillytaver-world-info-doc/world-info.js — the uid-keyed bag that makes
 * duplicates toxic — and worldinfo.md). A SillyTavern update requires a
 * re-read of the snapshot and a re-grounding of these policies.
 */

import { CharacterBook, isJsonObject } from './lorebook.model';
import type { BookDefect, BookDefectKind } from './book-schema';

/** The repair classes the dialog can offer, one per planned write. */
export type RepairChangeKind =
  | 'coerce-id' // "7" → 7 (string id parseable as a finite number, target free)
  | 'reassign-id' // duplicate (later occurrence loses) or unparseable id → fresh sequential id (max+1…)
  | 'default-insertion-order' // non-finite → 100 (normalizeImportedBook's own default)
  | 'unset-priority'; // non-finite → undefined (the documented unset)

/** One human-readable proposed write, dialog-ready. */
export interface RepairChange {
  readonly kind: RepairChangeKind;
  /** The entry's display title (the shared `entryTitle` convention, read defensively). */
  readonly entryTitle: string;
  /** The prior value, human-readable: `"7"`, `NaN`, `∞`, `(missing)`. */
  readonly from: string;
  /** The new value, human-readable: `7`, `100`, `(unset)`. */
  readonly to: string;
}

/** A planned repair: the repaired copy plus the change list that produced it. */
export interface BookRepair {
  /** The repaired copy (structuredClone base) — applied only on user consent. */
  readonly book: CharacterBook;
  /** Order-stable, dialog-ready change list (book order, then kind per entry). */
  readonly changes: readonly RepairChange[];
}

/** Kinds no repair may fix — their presence hard-blocks the whole plan. */
const UNFIXABLE_KINDS: ReadonlySet<BookDefectKind> = new Set<BookDefectKind>([
  'book-entries-not-array',
  'entry-content-not-string',
  'entry-keys-not-string-array',
  'entry-secondary-keys-not-string-array',
  'entry-extensions-not-object',
]);

/**
 * Plans the repair for `book` given `validateBook`'s defects. Returns `null`
 * when nothing (or nothing fixable) was flagged — the caller hard-blocks —
 * and never throws. Only kinds actually present in `defects` trigger their
 * repair pass, and every candidate is re-checked against the book's live
 * values, so the plan repairs exactly what is broken and nothing else.
 */
export function planBookRepair(
  book: CharacterBook,
  defects: readonly BookDefect[],
): BookRepair | null {
  if (defects.length === 0) {
    return null;
  }
  const entries: unknown = (book as unknown as Record<string, unknown> | null | undefined)?.[
    'entries'
  ];
  if (!Array.isArray(entries)) {
    return null; // book-entries-not-array is unfixable anyway
  }
  if (defects.some((defect) => UNFIXABLE_KINDS.has(defect.kind))) {
    return null;
  }
  const wantsIdRepair = defects.some(
    (defect) => defect.kind === 'entry-id-not-finite' || defect.kind === 'entry-id-duplicate',
  );
  const wantsOrderRepair = defects.some(
    (defect) => defect.kind === 'entry-insertion-order-not-finite',
  );
  const wantsPriorityRepair = defects.some((defect) => defect.kind === 'entry-priority-not-finite');

  let clone: CharacterBook;
  try {
    // structuredClone preserves insertion order of every key — the unknown
    // vendor keys, extension bags and field order all ride along verbatim.
    clone = structuredClone(book);
  } catch {
    return null; // function/symbol values cannot be cloned — not repairable losslessly
  }
  const records: (Record<string, unknown> | null)[] = (clone.entries as unknown[]).map((entry) =>
    isJsonObject(entry) ? entry : null,
  );

  // Per entry: the decided id write, `null` when the entry keeps its id. The
  // id machinery below runs only when an id defect was actually flagged — a
  // partial or fabricated defect list must not invent id changes (the plan
  // repairs exactly what is broken and nothing else).
  const idPlans: ({ readonly id: number; readonly kind: 'coerce-id' | 'reassign-id' } | null)[] =
    records.map(() => null);
  if (wantsIdRepair) {
    // --- Id decisions (classified first, applied in the emission pass) ------
    // Per entry: keep the finite numeric id, coerce a parseable string, or
    // reassign a fresh one. Null marks "no id change planned".
    type IdClass = 'keep' | 'reassign' | { readonly coerceTarget: number };
    const idClasses: (IdClass | null)[] = records.map((record) => {
      if (!record) {
        return null;
      }
      const raw = record['id'];
      if (raw === undefined) {
        return 'reassign';
      }
      if (typeof raw === 'number') {
        return Number.isFinite(raw) ? 'keep' : 'reassign';
      }
      if (typeof raw === 'string') {
        const target = parseableIdNumber(raw);
        return target === null ? 'reassign' : { coerceTarget: target };
      }
      return 'reassign'; // null, boolean, bigint, object — nothing to coerce
    });

    // Every reassign-class entry gets a fresh id; duplicate resolution below
    // adds the later occurrences that must lose their (valid) ids.
    const reassignBound = new Set<number>();
    records.forEach((record, index) => {
      if (record && idClasses[index] === 'reassign') {
        reassignBound.add(index);
      }
    });
    {
      const groups = new Map<string, number[]>();
      records.forEach((record, index) => {
        if (!record) {
          return;
        }
        const key = canonicalIdKey(record['id']);
        if (key !== null) {
          const members = groups.get(key);
          if (members) {
            members.push(index);
          } else {
            groups.set(key, [index]);
          }
        }
      });
      for (const members of groups.values()) {
        for (let i = 1; i < members.length; i++) {
          reassignBound.add(members[i] as number);
        }
      }
    }

    // Identities that will survive, keyed like the uid bag: keepers first, then
    // each approved coercion. Reassign-bound originals free their key.
    const takenKeys = new Set<string>();
    records.forEach((record, index) => {
      if (record && idClasses[index] === 'keep' && !reassignBound.has(index)) {
        // 'keep' classifies the id as a finite number, so the key is never
        // null — the guard states that invariant locally instead of casting.
        const key = canonicalIdKey(record['id']);
        if (key !== null) {
          takenKeys.add(key);
        }
      }
    });
    records.forEach((record, index) => {
      const idClass = idClasses[index];
      if (
        !record ||
        idClass === undefined ||
        idClass === null ||
        idClass === 'keep' ||
        idClass === 'reassign' ||
        reassignBound.has(index)
      ) {
        return;
      }
      const key = String(idClass.coerceTarget);
      if (!takenKeys.has(key)) {
        takenKeys.add(key);
        idPlans[index] = { id: idClass.coerceTarget, kind: 'coerce-id' };
        return;
      }
      reassignBound.add(index); // target taken — the coercion degrades to a renumber
    });
    {
      // Fresh sequential ids from max(finite ids across the book) + 1 — the max
      // ignores non-finite ids and counts even the ones being renumbered.
      let maxFinite = -1;
      records.forEach((record) => {
        if (!record) {
          return;
        }
        const raw = record['id'];
        if (typeof raw === 'number' && Number.isFinite(raw) && raw > maxFinite) {
          maxFinite = raw;
        }
      });
      let nextFresh = maxFinite + 1;
      records.forEach((record, index) => {
        if (!record || !reassignBound.has(index)) {
          return;
        }
        while (takenKeys.has(String(nextFresh))) {
          nextFresh += 1;
        }
        takenKeys.add(String(nextFresh));
        idPlans[index] = { id: nextFresh, kind: 'reassign-id' };
        nextFresh += 1;
      });
    }
  }

  // --- Emission pass: book order, kind order per entry, apply-as-reported ---
  const changes: RepairChange[] = [];
  records.forEach((record, index) => {
    if (!record) {
      return;
    }
    const title = repairTitle(record);
    const idPlan = idPlans[index];
    if (idPlan) {
      const from = renderPriorValue(record['id']);
      record['id'] = idPlan.id;
      changes.push({ kind: idPlan.kind, entryTitle: title, from, to: String(idPlan.id) });
    }
    if (wantsOrderRepair) {
      const order = record['insertion_order'];
      if (order !== undefined && !(typeof order === 'number' && Number.isFinite(order))) {
        record['insertion_order'] = 100;
        changes.push({
          kind: 'default-insertion-order',
          entryTitle: title,
          from: renderPriorValue(order),
          to: '100',
        });
      }
    }
    if (wantsPriorityRepair) {
      const priority = record['priority'];
      if (priority !== undefined && !(typeof priority === 'number' && Number.isFinite(priority))) {
        record['priority'] = undefined; // the documented unset, house entry shape
        changes.push({
          kind: 'unset-priority',
          entryTitle: title,
          from: renderPriorValue(priority),
          to: '(unset)',
        });
      }
    }
  });

  if (changes.length === 0) {
    return null; // nothing actionable — no plan to consent to
  }
  return { book: clone, changes };
}

/**
 * The duplicate-detection key — `String(id)`, the exact key the native
 * export's uid bag and SillyTavern's V2 conversion collapse on. Mirrors
 * book-schema's private helper of the same name; keep the two in sync.
 * No `String()` guard is needed here (unlike book-schema): the planner only
 * walks a structuredClone of the book, and a cloned tree cannot contain
 * symbols, functions, or other unstringable values — those fail the clone
 * itself and the plan returns `null` before this point.
 */
function canonicalIdKey(id: unknown): string | null {
  if (id === undefined || id === null) {
    return null;
  }
  return String(id);
}

/**
 * Parses a string id into its coerced number: `Number()` semantics over the
 * trimmed text, requiring a non-empty string and a finite result. `"7"` → 7,
 * `"1e3"` → 1000, `"  4  "` → 4; `""`, `"abc"`, `"NaN"`, `"Infinity"` → null.
 */
function parseableIdNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The entry's display title for the change list — the shared `entryTitle`
 * convention (comment, then name, then keys) read defensively: `keys` may be
 * one of the malformed fields, so it only qualifies as a runtime string array.
 */
function repairTitle(record: Record<string, unknown>): string {
  const comment = record['comment'];
  if (typeof comment === 'string' && comment.trim() !== '') {
    return comment;
  }
  const name = record['name'];
  if (typeof name === 'string' && name.trim() !== '') {
    return name;
  }
  const keys = record['keys'];
  if (Array.isArray(keys) && keys.length > 0 && keys.every((key) => typeof key === 'string')) {
    return keys.join(', ');
  }
  const raw = record['id'];
  const shown =
    typeof raw === 'number'
      ? renderNumber(raw)
      : typeof raw === 'string'
        ? JSON.stringify(raw)
        : '?';
  return `Entry ${shown}`;
}

/**
 * Human-readable rendering of a prior value for the change list: strings keep
 * their quotes (`"7"` — the dialog line distinguishes them from numbers),
 * non-finite numbers render as `NaN`/`∞`/`-∞`, absent as `(missing)`, and
 * anything else by its type. Never throws.
 */
function renderPriorValue(value: unknown): string {
  if (value === undefined) {
    return '(missing)';
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    return renderNumber(value);
  }
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'boolean' || typeof value === 'bigint') {
    return typeof value === 'bigint' ? `${value}n` : String(value);
  }
  return '(object)';
}

/** Human-readable number: finite values verbatim, non-finite by name. */
function renderNumber(value: number): string {
  if (Number.isNaN(value)) {
    return 'NaN';
  }
  if (value === Number.POSITIVE_INFINITY) {
    return '∞';
  }
  if (value === Number.NEGATIVE_INFINITY) {
    return '-∞';
  }
  return String(value);
}
