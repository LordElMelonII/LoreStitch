/**
 * LoreStitch project / version-control model — the app-domain half of the
 * data layer. Everything SillyTavern-shaped (the vendor contract and its
 * guards/converters) lives in `lorebook.model.ts`; this module owns the
 * workspace a LoreStitch project is edited in, its commit history, and the
 * `.stproj` archive surface. Nothing here is vendor schema.
 */

/**
 * The linter's rule union, type-only imported from the linter core: this
 * module needs the type for `LintPrefs`, but no runtime import (the linter
 * imports `lorebook.model`'s helpers at runtime, and a value import here
 * would close a circular import chain back into it). The runtime rule
 * whitelist for archive sanitizing lives beside `LintPrefs` below,
 * compile-time-exhaustive against this union.
 */
import type { LintRuleId } from '../services/linter';
import {
  isCharacterBook,
  isJsonObject,
  type CharacterBook,
  type TavernCardV2,
} from './lorebook.model';

// ============================================================================
// .stproj archive format
// ============================================================================

/**
 * Archive format version written by `exportProject`; import rejects newer ones.
 * Deliberately still 1 after `ProjectWorkspace.lintPrefs` (plan 03 §3.6.5.2):
 * the field is optional in the archive both ways, so old and new archives
 * interoperate without a bump.
 */
export const LORESTITCH_ARCHIVE_VERSION = 1;

// ============================================================================
// Workspace & commits
// ============================================================================

export interface ProjectCommit {
  id: string; // SHA-256 hash
  parentId: string | null;
  timestamp: number;
  message: string;
  snapshot: CharacterBook; // Full snapshot keeps rollbacks O(1)
}

export interface ProjectWorkspace {
  id: string; // UUID v4
  title: string;
  createdAt: number;
  updatedAt: number;
  /**
   * Legacy field: character-card projects existed before card support was
   * removed. New projects are always `standalone_lorebook`; the value is kept
   * so old `.stproj` archives and IndexedDB stores keep loading.
   */
  targetType: 'standalone_lorebook' | 'tavern_card_v2';
  /** Legacy card metadata from removed card imports; preserved verbatim. */
  rawCardData?: Omit<TavernCardV2['data'], 'character_book'>;
  activeBook: CharacterBook;
  headCommitId: string | null;
  commits: ProjectCommit[];
  /**
   * Linter preferences (plan 03 §3.6.5): the signatures of diagnostics the
   * author marked "not an issue" and the rules they muted. Workspace
   * metadata only — never part of `ProjectCommit.snapshot` (a
   * `CharacterBook`, so rollbacks neither touch nor carry it) and never
   * written to ST-facing exports. Optional in `.stproj` archives in both
   * directions, which is why `LORESTITCH_ARCHIVE_VERSION` stays 1: old and
   * new archives interoperate unchanged.
   */
  lintPrefs?: LintPrefs;
}

/**
 * Author's linter preferences, persisted in the `.stproj` archive and
 * IndexedDB (plan 03 §3.6.5). Both lists are sanitize inputs: order and
 * duplicates are preserved verbatim, malformed entries are dropped on import
 * (`sanitizeLintPrefs`), never sorted or de-duplicated.
 */
export interface LintPrefs {
  /** `lintDiagnosticSignature` values marked "not an issue" by the author. */
  ignoredSignatures: string[];
  /** Rule ids the author muted — passed to `lintBook` as `mutedRules`. */
  mutedRules: LintRuleId[];
}

/**
 * Compile-time-exhaustive runtime whitelist of `LintRuleId`. It lives beside
 * the archive model (not in `services/linter`) because archive sanitizing
 * must check rule ids at runtime, and the linter imports `lorebook.model` —
 * a runtime import from the model layer back into the linter would close a
 * circular import. Adding a rule to `LintRuleId` without updating this table
 * fails compilation here.
 */
const LINT_RULE_ID_TABLE: Record<LintRuleId, true> = {
  'invalid-regex': true,
  'duplicate-key': true,
  'secondary-keys-ignored': true,
  'selective-without-secondary': true,
  'never-activatable': true,
  'recursion-cycle': true,
  'self-trigger': true,
  'malformed-wrapper': true,
};

/** True when `value` is one of the linter's rule ids. */
export function isLintRuleId(value: unknown): value is LintRuleId {
  // Object.hasOwn, not `in`: prototype members like `toString` must not pass.
  return typeof value === 'string' && Object.hasOwn(LINT_RULE_ID_TABLE, value);
}

/**
 * Sanitizes an imported `lintPrefs` value (plan 03 §3.6.5.2). The choice is
 * resilient sanitize, not archive rejection — an old or hand-edited archive
 * must still load:
 *
 * - A non-object value (or absence, i.e. `undefined`) → `undefined`; callers
 *   treat that as "no preferences".
 * - `ignoredSignatures`: an array keeps its non-blank string entries in
 *   order (blank — empty or whitespace-only — and non-string entries are
 *   dropped: a blank signature could never match a real diagnostic; kept
 *   entries are never trimmed); a missing or wrong-typed key → `[]`.
 * - `mutedRules`: an array keeps its valid `LintRuleId` entries in order
 *   (unknown rule ids from other app versions are dropped); a missing or
 *   wrong-typed key → `[]`.
 * - Well-shaped values are kept content-verbatim: nothing is added,
 *   re-sorted, trimmed or de-duplicated.
 */
export function sanitizeLintPrefs(value: unknown): LintPrefs | undefined {
  if (!isJsonObject(value)) {
    return undefined;
  }
  const signatures = value['ignoredSignatures'];
  const rules = value['mutedRules'];
  return {
    ignoredSignatures: Array.isArray(signatures)
      ? signatures.filter(
          (signature): signature is string =>
            typeof signature === 'string' && signature.trim() !== '',
        )
      : [],
    mutedRules: Array.isArray(rules) ? rules.filter(isLintRuleId) : [],
  };
}

// ============================================================================
// Import validation guards
// ============================================================================

/** Structural guard for a commit: the fields the VCS / history code indexes. */
function isProjectCommit(value: unknown): value is ProjectCommit {
  return (
    isJsonObject(value) &&
    typeof value['id'] === 'string' &&
    (typeof value['parentId'] === 'string' || value['parentId'] === null) &&
    typeof value['timestamp'] === 'number' &&
    typeof value['message'] === 'string' &&
    isCharacterBook(value['snapshot'])
  );
}

/**
 * Structural guard for `ProjectWorkspace` at depth 1–2: the fields the
 * workspace, storage (the `by-updatedAt` index) and commit-history code index
 * must carry their declared types, `activeBook` and every commit snapshot
 * must pass `isCharacterBook`. Unknown extra keys are irrelevant here — they
 * round-trip untouched. `lintPrefs` is likewise never rejected here: it is
 * optional workspace metadata, and malformed values are sanitized on import
 * (`sanitizeLintPrefs`) instead of failing the archive (plan 03 §3.6.5.2).
 */
export function isProjectWorkspace(json: unknown): json is ProjectWorkspace {
  return (
    isJsonObject(json) &&
    typeof json['id'] === 'string' &&
    typeof json['title'] === 'string' &&
    typeof json['createdAt'] === 'number' &&
    typeof json['updatedAt'] === 'number' &&
    (typeof json['headCommitId'] === 'string' || json['headCommitId'] === null) &&
    isCharacterBook(json['activeBook']) &&
    Array.isArray(json['commits']) &&
    json['commits'].every((commit: unknown) => isProjectCommit(commit))
  );
}
