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
import {
  base64DecodeBytes,
  base64EncodeBytes,
  isCardChunkKeyword,
  isCardSpec,
  type CardChunkKeyword,
  type CardSpec,
} from './character-card';

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
  /**
   * Character-card shell (plan 15 §3.2): the container the project was
   * imported from, kept so card exports can re-embed the edited book.
   * Undefined for projects that came from neither a card PNG nor a card
   * JSON — both card exports stay disabled for them (LoreStitch never
   * fabricates cards). A shell from a JSON-card import carries `cardJson`
   * but no `pngBytes`: JSON card export works, PNG export stays disabled.
   * VCS is unaffected: commit hashing covers the book only, so holding a
   * shell never dirties history. `pngBytes` is stored as-is — IndexedDB's
   * structured clone handles `Uint8Array` natively.
   */
  cardShell?: CardShell;
}

/**
 * The remembered card container (plan 15 §3.2, with the orchestrator-approved
 * dual-chunk generalization): a real card PNG may carry *both* a `chara`
 * (V2) and a `ccv3` (V3) text chunk, each holding its own independent full
 * card JSON. A single `pngKeyword` cannot represent that, so the shell keeps
 * the preferred payload (`cardJson`, from the `pngKeyword` chunk — `ccv3`
 * first on import) plus per-keyword payloads of the other card chunk(s).
 */
export interface CardShell {
  /** Card spec of the preferred payload (`chara_card_v2` | `chara_card_v3`). */
  readonly spec: CardSpec;
  /**
   * The preferred card JSON text, verbatim as stored in the source — on
   * export only `data.character_book` is swapped and the rest re-serialized.
   */
  readonly cardJson: string;
  /** Keyword of the chunk `cardJson` came from (export reuses that chunk). */
  readonly pngKeyword?: CardChunkKeyword;
  /**
   * PNG bytes of the imported card; undefined for JSON-card sources.
   * Stored as-is (IndexedDB structured clone handles `Uint8Array`); the
   * `.stproj` archive transform re-encodes them as base64 — see
   * `serializeWorkspaceForArchive`.
   */
  readonly pngBytes?: Uint8Array;
  /**
   * Card JSON payloads of the *other* card-carrying chunks (dual-chunk
   * cards), keyed by their chunk keyword — export re-embeds every chunk the
   * source had so none is left holding a stale book.
   */
  readonly extraCardJson?: Partial<Record<CardChunkKeyword, string>>;
}

/**
 * Structural guard for an imported `CardShell` (archive tolerance, plan 15
 * §3.2): the minimal shape export needs — spec string, card JSON string,
 * well-typed optional keyword/bytes/extra-payload fields. Card JSON content
 * is never validated here (it opens through the card codec at export time);
 * unknown extra keys ride untouched. An absent shell is not an error — the
 * field is simply optional.
 */
export function isCardShell(value: unknown): value is CardShell {
  if (!isJsonObject(value) || !isCardSpec(value['spec'])) {
    return false;
  }
  if (typeof value['cardJson'] !== 'string') {
    return false;
  }
  if (value['pngKeyword'] !== undefined && !isCardChunkKeyword(value['pngKeyword'])) {
    return false;
  }
  if (value['pngBytes'] !== undefined && !(value['pngBytes'] instanceof Uint8Array)) {
    return false;
  }
  const extra = value['extraCardJson'];
  if (extra !== undefined) {
    if (!isJsonObject(extra)) {
      return false;
    }
    for (const keyword of Object.keys(extra)) {
      if (!isCardChunkKeyword(keyword) || typeof extra[keyword] !== 'string') {
        return false;
      }
    }
  }
  return true;
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
// Card-shell archive transform (plan 15 §3.2)
// ============================================================================

/**
 * Archive (JSON) form of `CardShell`: `pngBytes` must not ride
 * `JSON.stringify` — a `Uint8Array` serializes as a keyed object, not data —
 * so the archive writer re-encodes it as explicit base64 under
 * `pngBytesBase64` and the reader decodes it back (symmetric; ~+33% on the
 * image bytes only). A shell without `pngBytes` (JSON-card source) serializes
 * without the field at all, and archives without a shell are byte-identical
 * to before.
 */
export function serializeWorkspaceForArchive(project: ProjectWorkspace): Record<string, unknown> {
  const shell = project.cardShell;
  if (shell === undefined || shell.pngBytes === undefined) {
    // No shell, or a JSON-card shell: nothing to transform — the clone keeps
    // the archive bytes exactly as they were before card shells existed.
    return structuredClone(project) as unknown as Record<string, unknown>;
  }
  const clone = structuredClone(project);
  // The serialized shell carries `pngBytesBase64` instead of `pngBytes` (the
  // archive contract, not the in-memory shape) — unknown extra keys ride
  // along untouched, matching the archive's never-drop stance.
  const { pngBytes: _bytes, ...rest } = shell as unknown as Record<string, unknown>;
  const serializedShell: Record<string, unknown> = {
    ...rest,
    pngBytesBase64: base64EncodeBytes(shell.pngBytes),
  };
  return {
    ...(clone as unknown as Record<string, unknown>),
    cardShell: serializedShell,
  };
}

/**
 * The import half of the archive transform: a shell carrying
 * `pngBytesBase64` (written by `serializeWorkspaceForArchive`) is decoded
 * back into in-memory `pngBytes`; a shell that already carries `pngBytes`
 * (in-memory object passed straight through) passes unchanged; undecodable
 * base64 is dropped — the shell keeps its JSON so the card-JSON export
 * still works, only the PNG export stays disabled. Workspaces without a
 * shell pass through verbatim, so old archives load byte-for-byte as before.
 */
export function deserializeWorkspaceFromArchive(workspace: ProjectWorkspace): ProjectWorkspace {
  const shell = workspace.cardShell;
  if (shell === undefined) {
    return workspace;
  }
  const archive = shell as unknown as Record<string, unknown>;
  const base64 = archive['pngBytesBase64'];
  if (shell.pngBytes !== undefined || typeof base64 !== 'string') {
    // Already decoded, nothing to decode, or an undecodable payload.
    return workspace;
  }
  const decoded = base64DecodeBytes(base64);
  if (!decoded) {
    // Hand-mangled archive: keep the shell's JSON, drop the broken bytes.
    const { pngBytesBase64: _broken, ...withoutBytes } = shell as unknown as Record<string, unknown>;
    return { ...workspace, cardShell: withoutBytes as unknown as CardShell };
  }
  // Decoded form drops the base64 field — the in-memory shape carries bytes.
  const { pngBytesBase64: _decoded, ...shellRest } = shell as unknown as Record<string, unknown>;
  return {
    ...workspace,
    cardShell: { ...shellRest, pngBytes: decoded } as unknown as CardShell,
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
 * `cardShell` (plan 15 §3.2) *is* shape-checked when present — a malformed
 * shell would silently disable card exports — but its JSON content is not
 * validated (the card codec does that at export time).
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
    json['commits'].every((commit: unknown) => isProjectCommit(commit)) &&
    (json['cardShell'] === undefined || isCardShell(json['cardShell']))
  );
}
