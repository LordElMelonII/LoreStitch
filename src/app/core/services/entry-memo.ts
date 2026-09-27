import type { CharacterBookEntry, EntryExtensions } from '../models/lorebook.model';
import { entryTags, entryTitle, entryTriggers } from '../models/lorebook.model';
import {
  detectMalformedWrapper,
  entryDelimiterName,
  entryDelimiterNameFromKey,
  malformedWrapperLabel,
} from '../models/delimiters';
import { isRegexShapedKey, isValidStRegex } from '../models/st-regex';
import { estimateTokens } from './token-estimator';
// Type-only on purpose: the runtime dependency stays one-directional
// (linter.ts → entry-memo.ts → core/models) with no linter↔entry-memo cycle —
// LintDiagnostic never flows as a value import back into this module.
import type { LintDiagnostic } from './linter';

/**
 * Identity-keyed per-entry memoization for the hot per-entry derivations
 * (plan 18 D2): token estimates, search haystacks, and the five entry-scoped
 * linter rules. A once-per-settle full-book pass costs O(changed) real work
 * plus an O(V) walk over memo hits instead of recomputing every entry.
 *
 * - Internal WeakMaps keyed by entry object identity; **no clear/invalidate
 *   API** — stale entries are reclaimed by GC together with their entry
 *   objects, the same contract as `canonicalSerializations` in
 *   `vcs.service.ts`.
 * - Observably pure: same entry object → same output, always. Correctness
 *   rests on the app-wide immutable-update invariant — model values are
 *   never mutated in place; every change produces new references with
 *   structural sharing — the same contract `vcs.service.ts` documents for
 *   `canonicalSerializations`.
 * - Bare module, no decorator — the `sha256.ts`/`token-estimator.ts`
 *   convention for pure analysis code in services/. No Angular imports (core
 *   invariant).
 * - There is a function-level mutual import with `token-estimator.ts` (this
 *   module wraps its `estimateTokens`; its `computeTokenFootprint` consumes
 *   `memoEntryTokens`): benign under ESM live bindings because neither
 *   module calls the other during module evaluation, and there is no
 *   import/no-cycle lint rule in this repo (verified).
 */

// ============================================================================
// Token memo
// ============================================================================

/** Token estimates keyed by entry identity (see the module head). */
const memoizedEntryTokens = new WeakMap<CharacterBookEntry, number>();

/**
 * Tokens the entry contributes when activated — the memoized form of
 * `estimateTokens(entry.content ?? '')` (identical to the primitive
 * `estimateEntryTokens`): SillyTavern injects the entry content only, so the
 * estimate covers `content` alone.
 */
export function memoEntryTokens(entry: CharacterBookEntry): number {
  const cached = memoizedEntryTokens.get(entry);
  if (cached !== undefined) {
    return cached;
  }
  const tokens = estimateTokens(entry.content ?? '');
  memoizedEntryTokens.set(entry, tokens);
  return tokens;
}

// ============================================================================
// Search haystack (moved from entry-list.model.ts)
// ============================================================================

/**
 * Pre-folds an entry's searchable text into one lowercase haystack:
 * `[title, ...keys, ...tags, content]` joined on `'\n'` and lowercased once
 * per entry change, so the per-keystroke filter scan becomes a
 * zero-allocation `includes` instead of re-lowercasing every field —
 * including a fresh copy of the full `content` — for each keystroke
 * (Task 07: search responsiveness).
 *
 * Equivalence with the previous per-field checks (`title || keys || tags ||
 * content`, each `toLowerCase().includes(query)`): the sidebar filter reads
 * its query from a single-line text input, and the WHATWG input
 * sanitization algorithm strips newlines from single-line values, so a
 * query can never contain the `'\n'` separator — every query the old scan
 * matched lies wholly inside one field of the join, and no cross-field
 * query can appear.
 *
 * Memory trade: the joined copy roughly doubles the text held for the open
 * book (one extra content-sized string per entry). The documented fallback —
 * per-item memoized folding keyed on entry identity — is now built:
 * `memoEntryHaystack` below (next_tasks/07-search-responsiveness.md §7.2,
 * built by plan 18 D2).
 *
 * This primitive moved here from `entry-list.model.ts` (behavior unchanged):
 * core must not import from features (layering rule), so the fold lives
 * core-side next to the memo that composes it, and `entry-list.model.ts`
 * re-exports it so every existing import site keeps working.
 */
export function entrySearchHaystack(
  title: string,
  keys: readonly string[],
  tags: readonly string[],
  content: string,
): string {
  return [title, ...keys, ...tags, content].join('\n').toLowerCase();
}

/** Search haystacks keyed by entry identity (see the module head). */
const memoizedEntryHaystacks = new WeakMap<CharacterBookEntry, string>();

/**
 * The entry's pre-folded search haystack — `entrySearchHaystack` composed
 * with the entry's searchable fields, in exactly the argument order the
 * entries-sidebar `items` computed uses: `entryTitle(entry)`,
 * `entry.keys ?? []`, `entryTags(entry)`, `entry.content ?? ''`.
 */
export function memoEntryHaystack(entry: CharacterBookEntry): string {
  const cached = memoizedEntryHaystacks.get(entry);
  if (cached !== undefined) {
    return cached;
  }
  const haystack = entrySearchHaystack(
    entryTitle(entry),
    entry.keys ?? [],
    entryTags(entry),
    entry.content ?? '',
  );
  memoizedEntryHaystacks.set(entry, haystack);
  return haystack;
}

// ============================================================================
// Typed extension reads (entry-activation exemplar pattern — never `as any`)
// (moved from linter.ts; exported because linter.ts's remaining book-level
// passes — duplicate-key buckets and the recursion graph — read them too)
// ============================================================================

/**
 * The entry's extension bag. `extensions` is typed required, but the model
 * itself reads it defensively (`entryTriggerState` in `lorebook.model.ts`) —
 * mirrored here for hand-built books.
 */
export function entryExt(entry: CharacterBookEntry): Record<string, unknown> {
  return entry.extensions ?? {};
}

/** True when the entry carries the given boolean extension flag. */
export function extFlag(ext: Record<string, unknown>, key: keyof EntryExtensions): boolean {
  return ext[key] === true;
}

/** The entry's string extension value (`''` when absent or not a string). */
export function extText(ext: Record<string, unknown>, key: keyof EntryExtensions): string {
  const value = ext[key];
  return typeof value === 'string' ? value : '';
}

/** Tri-state boolean option (`null` = unset → ST default inside `matchStKey`). */
export function extBoolOption(ext: Record<string, unknown>, key: keyof EntryExtensions): boolean | null {
  const value = ext[key];
  return typeof value === 'boolean' ? value : null;
}

/**
 * The ST `match_*` alternate-activation source flags (`EntryExtensions` in
 * `lorebook.model.ts`) with their legacy camelCase spellings — books
 * imported before normalization carry only the verbatim native key
 * (mirrors `legacyFlag` in `lorebook.model.ts`).
 */
const MATCH_SOURCE_FLAGS: readonly { normalized: keyof EntryExtensions; legacy: string }[] = [
  { normalized: 'match_persona_description', legacy: 'matchPersonaDescription' },
  { normalized: 'match_character_description', legacy: 'matchCharacterDescription' },
  { normalized: 'match_character_personality', legacy: 'matchCharacterPersonality' },
  { normalized: 'match_character_depth_prompt', legacy: 'matchCharacterDepthPrompt' },
  { normalized: 'match_scenario', legacy: 'matchScenario' },
  { normalized: 'match_creator_notes', legacy: 'matchCreatorNotes' },
];

/** Reads a possibly-legacy match flag as a strict boolean. */
function extLegacyFlag(
  ext: Record<string, unknown>,
  normalized: keyof EntryExtensions,
  legacy: string,
): boolean {
  const value = ext[normalized] ?? ext[legacy];
  return typeof value === 'boolean' ? value : false;
}

// ============================================================================
// Shared helpers (moved from linter.ts; exported for the book-level passes)
// ============================================================================

/** True when at least one key is non-blank (usable for activation). */
export function hasUsableKeys(keys: readonly string[]): boolean {
  return keys.some((key) => key.trim() !== '');
}

/**
 * Resolves the reported id for an entry. Ids are assigned by
 * `normalizeImportedBook` in `lorebook.model.ts` and `WorkspaceService`, so
 * the index fallback is type defense only (plan §7.5).
 */
export function entryRefId(entry: CharacterBookEntry, index: number): number {
  return entry.id ?? index;
}

// ============================================================================
// Entry-scoped rules (run regardless of `enabled` — configuration defects
// ship in exported bytes and survive re-enabling; only the rules the plan
// table pins to *enabled* entries filter on it)
//
// The five rules below ARE per-entry derivations, so they live here (moved
// verbatim from linter.ts, plan 18 D2): hosting them next to the per-entry
// memo keeps a one-directional import graph — linter.ts → entry-memo.ts →
// core/models — with no linter↔entry-memo cycle.
// ============================================================================

/** Emission callback of the per-entry rules (collected by `lintEntryRules`). */
type Emit = (diagnostic: LintDiagnostic, firstIndex: number) => void;

/**
 * Rule `invalid-regex` (error): a `/body/flags`-shaped key on any primary or
 * secondary key that ST would refuse to compile. No suppressions — ST
 * silently mis-handles the key, so the defect is diagnosed everywhere.
 */
function lintInvalidRegexKeys(entry: CharacterBookEntry, index: number, emit: Emit): void {
  for (const key of [...entry.keys, ...(entry.secondary_keys ?? [])]) {
    if (isRegexShapedKey(key) && !isValidStRegex(key)) {
      emit(
        {
          rule: 'invalid-regex',
          severity: 'error',
          entryIds: [entryRefId(entry, index)],
          message: `Entry "${entryTitle(entry)}" has a regex-shaped key that is not a valid regex — SillyTavern will not treat it as a regex.`,
          details: key,
        },
        index,
      );
    }
  }
}

/**
 * Rule `malformed-wrapper` (error for `mismatched`, warning for orphans):
 * the exact `detectMalformedWrapper` hint chain of the `entry-content-field`
 * badge (entry-content-field.ts), reported regardless of `enabled` — the
 * defect ships in exported bytes. The linter adds no repair path.
 */
function lintMalformedWrapper(entry: CharacterBookEntry, index: number, emit: Emit): void {
  const malformed = detectMalformedWrapper(entry.content, [
    entryDelimiterName(entry),
    entryDelimiterNameFromKey(entry),
  ]);
  if (malformed === null) {
    return;
  }
  emit(
    {
      rule: 'malformed-wrapper',
      severity: malformed.kind === 'mismatched' ? 'error' : 'warning',
      entryIds: [entryRefId(entry, index)],
      message: `Entry "${entryTitle(entry)}" content has a malformed whole-content wrapper.`,
      details: malformedWrapperLabel(malformed),
    },
    index,
  );
}

/**
 * Rule `secondary-keys-ignored` (warning): secondary keys present while
 * `constant` (ST ignores all keys) or not `selective` (ST ignores secondary
 * keys). The two causes get distinct messages per the plan table.
 */
function lintIgnoredSecondaryKeys(entry: CharacterBookEntry, index: number, emit: Emit): void {
  const secondary = entry.secondary_keys ?? [];
  if (secondary.length === 0) {
    return;
  }
  const base = {
    rule: 'secondary-keys-ignored' as const,
    severity: 'warning' as const,
    entryIds: [entryRefId(entry, index)],
  };
  if (entry.constant === true) {
    emit(
      {
        ...base,
        message: `Entry "${entryTitle(entry)}" is constant — SillyTavern ignores all of its keys, including these secondary keys.`,
      },
      index,
    );
    return;
  }
  if (!entry.selective) {
    emit(
      {
        ...base,
        message: `Entry "${entryTitle(entry)}" is not selective — SillyTavern ignores its secondary keys.`,
      },
      index,
    );
  }
}

/** Rule `selective-without-secondary` (info): harmless but usually unintended. */
function lintSelectiveWithoutSecondary(entry: CharacterBookEntry, index: number, emit: Emit): void {
  if (entry.selective === true && (entry.secondary_keys ?? []).length === 0) {
    emit(
      {
        rule: 'selective-without-secondary',
        severity: 'info',
        entryIds: [entryRefId(entry, index)],
        message: `Entry "${entryTitle(entry)}" is selective but has no secondary keys to match against.`,
      },
      index,
    );
  }
}

/**
 * Rule `never-activatable` (warning): not constant, no usable primary key,
 * and no alternate activation source (`vectorized`, `automation_id`,
 * `triggers`, any `match_*` flag).
 */
function lintNeverActivatable(entry: CharacterBookEntry, index: number, emit: Emit): void {
  if (entry.constant === true || hasUsableKeys(entry.keys) || hasAlternateActivation(entry)) {
    return;
  }
  emit(
    {
      rule: 'never-activatable',
      severity: 'warning',
      entryIds: [entryRefId(entry, index)],
      message: `Entry "${entryTitle(entry)}" has no primary keys and no alternate activation source — it can never activate.`,
    },
    index,
  );
}

/** Alternate activation sources that suppress `never-activatable`. */
function hasAlternateActivation(entry: CharacterBookEntry): boolean {
  const ext = entryExt(entry);
  return (
    extFlag(ext, 'vectorized') ||
    extText(ext, 'automation_id').trim() !== '' ||
    entryTriggers(entry).length > 0 ||
    MATCH_SOURCE_FLAGS.some((flag) => extLegacyFlag(ext, flag.normalized, flag.legacy))
  );
}

/**
 * Runs all five entry-scoped rules for one entry in `lintBook`'s emission
 * order (invalid-regex, malformed-wrapper, secondary-keys-ignored,
 * selective-without-secondary, never-activatable) and returns the
 * unfiltered diagnostics array — `mutedRules`/`ignored` filtering stays with
 * `lintBook` so the pinned options semantics are untouched.
 */
export function lintEntryRules(entry: CharacterBookEntry, index: number): LintDiagnostic[] {
  const diagnostics: LintDiagnostic[] = [];
  const emit: Emit = (diagnostic) => {
    diagnostics.push(diagnostic);
  };
  lintInvalidRegexKeys(entry, index, emit);
  lintMalformedWrapper(entry, index, emit);
  lintIgnoredSecondaryKeys(entry, index, emit);
  lintSelectiveWithoutSecondary(entry, index, emit);
  lintNeverActivatable(entry, index, emit);
  return diagnostics;
}

/** Per-entry lint diagnostics keyed by entry identity (see the module head). */
const memoizedEntryLint = new WeakMap<CharacterBookEntry, readonly LintDiagnostic[]>();

/**
 * The entry's five entry-scoped-rule diagnostics, memoized by identity.
 *
 * **Id-carrying entries only**: `entryRefId` resolves `entry.id ?? index`,
 * so for an id-less entry the diagnostics depend on the entry's array
 * position and a reorder would stale the cache. Callers holding the array
 * index — `lintBook` — must route id-less entries to
 * `lintEntryRules(entry, index)` instead (workspace books always carry ids;
 * hand-built test books may not). For an id-carrying entry the index
 * argument is irrelevant (`entryRefId` resolves to `entry.id`), so the cache
 * is keyed by the entry alone.
 */
export function memoEntryLint(entry: CharacterBookEntry): readonly LintDiagnostic[] {
  const cached = memoizedEntryLint.get(entry);
  if (cached !== undefined) {
    return cached;
  }
  const id = entry.id;
  const diagnostics = lintEntryRules(entry, typeof id === 'number' ? id : 0);
  if (typeof id === 'number') {
    memoizedEntryLint.set(entry, diagnostics);
  }
  return diagnostics;
}
