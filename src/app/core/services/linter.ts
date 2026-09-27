import type { CharacterBook, CharacterBookEntry } from '../models/lorebook.model';
import { entryTitle } from '../models/lorebook.model';
import { parseStRegex, type StRegex } from '../models/st-regex';
import { findPlaintextRanges } from '../models/st-key-match';
import {
  entryExt,
  entryRefId,
  extBoolOption,
  extFlag,
  extText,
  hasUsableKeys,
  lintEntryRules,
  memoEntryLint,
} from './entry-memo';

/**
 * Lorebook health linter — one pure, read-only diagnostic pass over a
 * `CharacterBook` (plan §3.2).
 *
 * Surfaces the failure classes SillyTavern never reports: regex keys that
 * cannot compile (silently mis-parsed), duplicate primary keys competing for
 * the same activation, ignored/orphaned secondary keys, entries that can
 * never activate, recursion cycles, self-triggers and malformed whole-content
 * wrappers. `lintBook` never mutates its input (the lossless invariant) and
 * is fully deterministic, so it is safe inside `computed()` signal graphs.
 *
 * Bare module, no decorator — the `sha256.ts`/`token-estimator.ts` convention
 * for pure analysis code in services/. No Angular imports (core invariant).
 *
 * Semantics:
 * - Regex shape/validity and key matching delegate to the P1 modules
 *   `st-regex.ts` / `st-key-match.ts` — faithful ports of the vendored
 *   `world-info.js` oracle (line refs there).
 * - The five entry-scoped rules (invalid-regex, malformed-wrapper,
 *   secondary-keys-ignored, selective-without-secondary, never-activatable)
 *   live in `entry-memo.ts` next to their per-entry identity-keyed
 *   memoization (plan 18 D2); `lintBook` sources their diagnostics through
 *   `memoEntryLint`/`lintEntryRules`. They are per-entry derivations, so
 *   hosting them there keeps the import graph one-directional
 *   (linter.ts → entry-memo.ts → core/models).
 * - Recursion edges follow plan §3.2 verbatim. Whole entry content is
 *   scanned: a conservative superset of ST's `scan_depth` message window.
 *   `extensions.scan_depth` is deliberately ignored (§7.2 decision at P2
 *   kickoff) — the recursion copy therefore says "may activate during
 *   recursion", and the severity stays warning, not error.
 * - Malformed wrappers reuse the exact `detectMalformedWrapper` hint chain of
 *   the `entry-content-field` badge, so the two surfaces can never disagree
 *   (§7.6); the linter only diagnoses — repair stays in the delimiter flow.
 * - Per-issue ignores and rule mutes (plan 03 §3.6.5) ride the `LintOptions`
 *   argument of `lintBook`; the no-options call keeps producing exactly the
 *   pre-options output (pinned in linter.spec.ts).
 */

export type LintSeverity = 'error' | 'warning' | 'info';

export type LintRuleId =
  | 'invalid-regex'
  | 'duplicate-key'
  | 'secondary-keys-ignored'
  | 'selective-without-secondary'
  | 'never-activatable'
  | 'recursion-cycle'
  | 'self-trigger'
  | 'malformed-wrapper';

export interface LintDiagnostic {
  rule: LintRuleId;
  severity: LintSeverity;
  /** Ids of the entries involved, resolved as `entry.id ?? array index`. */
  entryIds: number[];
  /** Human sentence, `entryTitle()`-based. */
  message: string;
  /** e.g. the duplicated key, the cycle path `A → B → A`, or the wrapper label. */
  details?: string;
}

/**
 * Options for `lintBook` (plan 03 §3.6.5.1). Both fields are optional;
 * passing no options — or `{}` — reproduces the plain `lintBook(book)`
 * output exactly (pinned in linter.spec.ts).
 */
export interface LintOptions {
  /**
   * Signatures (see `lintDiagnosticSignature`) of diagnostics to suppress.
   * Suppression is exact: a signature matches exactly one emitted finding,
   * so near-misses — the same rule on other entries, or the same entries
   * with different details — stay visible.
   */
  ignored?: ReadonlySet<string>;
  /**
   * Rules to skip at emission. Muting the O(V·E) recursion rules still skips
   * the graph build outright (genuine short-circuit); the entry-scoped rules
   * are memoized per-entry derivations (plan 18 D2), so muting them filters
   * their diagnostics at emission instead of skipping the checks —
   * observably identical output. Muting `recursion-cycle` also silences the
   * book-level large-book skip note, which ships with that rule id —
   * coherent and intended (plan 03 §3.6.5.1, pinned in linter.spec.ts).
   */
  mutedRules?: ReadonlySet<LintRuleId>;
  /**
   * Whether the recursion-graph rules (`recursion-cycle`, `self-trigger`) and
   * their book-level large-book skip note run at all. Optional, default
   * `true` — the no-options contract is unchanged (pinned in linter.spec.ts).
   * `false` is the live badge's graph-free pass (plan 18 D3/D4): the O(V²)
   * pair loop and the skip note stay out of the per-keystroke path, while the
   * cheap (~5 ms) duplicate-key buckets run in both modes so the badge stays
   * meaningfully complete. The health pane reads the full pass and surfaces
   * the graph findings.
   */
  includeGraphRules?: boolean;
}

/**
 * Deterministic persistence key for one diagnostic (plan 03 §3.6.5.1), the
 * format `` `${rule}|${entryIds.join(',')}|${details ?? ''}` ``.
 *
 * - Derived only from the diagnostic's own fields, so it is stable across
 *   runs and app restarts for the same book.
 * - `entryIds` resolve as `entry.id ?? array index`; ids are assigned by
 *   `normalizeImportedBook` in `lorebook.model.ts` and `WorkspaceService`,
 *   so signatures are stable for id-carrying — i.e. normalized — books.
 * - Book-level diagnostics (the large-book skip note) carry `entryIds: []`
 *   and no `details` → the `` `rule||` `` shape; diagnostics without
 *   `details` end with a trailing `|`.
 * - Distinct findings produce distinct signatures: per-entry rules emit at
 *   most one diagnostic per cause (e.g. `secondary-keys-ignored` picks
 *   either the constant or the non-selective message, never both), and
 *   multi-entry diagnostics disambiguate through `details` — one pair
 *   colliding on two keys yields two signatures.
 */
export function lintDiagnosticSignature(diagnostic: LintDiagnostic): string {
  return `${diagnostic.rule}|${diagnostic.entryIds.join(',')}|${diagnostic.details ?? ''}`;
}

/**
 * Above this many entries the graph rules (`recursion-cycle`, `self-trigger`)
 * are skipped and one `info` diagnostic notes the skip (plan §3.2 perf
 * guard); the O(V·k) key rules always run.
 */
export const LARGE_BOOK_THRESHOLD = 1500;

/**
 * `matchStKey` haystack cap — bounds catastrophic-pattern cost on huge
 * contents (plan §3.2, the same bound Task 04 sets for its playground).
 */
const MATCH_CONTENT_CAP = 5000;

/** Sort rank per severity: error → warning → info. */
const SEVERITY_RANK: Record<LintSeverity, number> = { error: 0, warning: 1, info: 2 };

// ============================================================================
// Shared helpers
// ============================================================================

/** `"A", "B" and "C"` — quoted serial list for messages. */
function quotedList(items: readonly string[]): string {
  const quoted = items.map((item) => `"${item}"`);
  if (quoted.length === 0) {
    return '';
  }
  if (quoted.length === 1) {
    return quoted[0] ?? '';
  }
  return `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1] ?? ''}`;
}

/**
 * First key of the entry's key list matching `content` under ST `matchKeys`
 * semantics, or `null`. Oracle-equivalent to
 * `keys.find(k => matchStKey(k, content, options))`, computed from a
 * per-target `TargetKeyPlan` (see `prepareTargetKeys`) plus a per-source
 * pre-folded haystack — the recursion pass matches the same target keys
 * against every source, so per-key work is hoisted out of its O(V²) pair
 * loop. Equivalence notes, in key order:
 *
 * - Regex keys bypass every option (world-info.js:338-342) and always test
 *   the raw haystack. The plan's compiled regex is REUSED across pairs;
 *   `lastIndex` is reset before each test, which is observably identical to
 *   `matchStKey`'s fresh-per-call `RegExp` for a boolean `test` (a fresh
 *   regex means `lastIndex === 0`; non-global tests ignore it entirely).
 * - Plaintext keys call `findPlaintextRanges` directly: the plan already ran
 *   the `parseStRegex` gate on the raw key. Classification must stay on the
 *   raw spelling — folding a key can change that gate's verdict (e.g. the
 *   flags of `/x/G` fold into the valid `/x/g`).
 * - Case-insensitive plaintext keys test pre-folded key and haystack with
 *   `caseSensitive: true`, which skips `findPlaintextRanges`' internal
 *   `toLowerCase` folds (idempotent on already-folded input). Key order and
 *   the first-match-wins rule are semantic: the matched spelling is reported
 *   in `self-trigger` details.
 */
function firstMatchingKey(
  plan: TargetKeyPlan,
  content: string,
  foldedContent: string,
  caseSensitive: boolean | undefined,
  matchWholeWords: boolean | null,
): string | null {
  // Tri-state resolution matches resolveStMatchOptions in st-key-match.ts:
  // nullish means ST's global default (false).
  const wholeWords = matchWholeWords ?? false;
  for (const key of plan) {
    if (key.regex) {
      key.regex.regex.lastIndex = 0;
      if (key.regex.regex.test(content)) {
        return key.spelling;
      }
      continue;
    }
    if (caseSensitive === true) {
      if (findPlaintextRanges(key.spelling, content, true, wholeWords).length > 0) {
        return key.spelling;
      }
      continue;
    }
    if (findPlaintextRanges(key.folded, foldedContent, true, wholeWords).length > 0) {
      return key.spelling;
    }
  }
  return null;
}

/** One target key with its per-pass match facts (see `TargetKeyPlan`). */
interface PlannedKey {
  /** The key as written — the reported spelling on a match. */
  readonly spelling: string;
  /** `parseStRegex(spelling)`; `null` takes the plaintext path. */
  readonly regex: StRegex | null;
  /** `spelling.toLowerCase()` — for the case-insensitive plaintext path. */
  readonly folded: string;
}

/** Read-only alias: the plan is an ordered key list, first match wins. */
type TargetKeyPlan = readonly PlannedKey[];

/**
 * Computes one target entry's `TargetKeyPlan`. Pure; each key's facts are
 * deterministic, so hoisting this out of the pair loop cannot change any
 * verdict — it only replaces O(V²·k) `parseStRegex`/fold calls with O(V·k).
 */
function prepareTargetKeys(entry: CharacterBookEntry): TargetKeyPlan {
  return entry.keys.map((spelling) => ({
    spelling,
    regex: parseStRegex(spelling),
    folded: spelling.toLowerCase(),
  }));
}

// ============================================================================
// Collection & sorting
// ============================================================================

type Emit = (diagnostic: LintDiagnostic, firstIndex: number) => void;

/** A diagnostic plus its sort anchors (severity order, then book order). */
interface Collected {
  diagnostic: LintDiagnostic;
  /** Entry array index anchoring multi-entry diagnostics (lowest member). */
  firstIndex: number;
  /** Emission sequence — the final determinism tiebreak. */
  seq: number;
}

/**
 * Runs every rule and returns the diagnostics sorted by severity
 * (error → warning → info) then entry order (the book's entry array index;
 * multi-entry diagnostics anchor on their lowest member). The emission
 * sequence breaks remaining ties so the output is deterministic.
 *
 * With options (plan 03 §3.6.5.1): `mutedRules` drops a rule's diagnostics at
 * emission — for the O(V·E) recursion rules before the graph is even built,
 * for the entry-scoped rules as an emission-time filter over their memoized
 * results (plan 18 D2, observably identical to the old skip-before-check);
 * `ignored` drops exactly the diagnostics whose signature is in the set.
 * `includeGraphRules: false` skips the recursion pass entirely — both graph
 * rules and the book-level large-book skip note. Filtering precedes the
 * sort, so the surviving output keeps the plain pass's severity→entry-order
 * order. The call stays pure, read-only and deterministic with options
 * passed; `lintBook(book)` and `lintBook(book, {})` produce exactly the
 * pre-options output.
 */
export function lintBook(book: CharacterBook, options?: LintOptions): LintDiagnostic[] {
  const entries = book.entries;
  const collected: Collected[] = [];
  let sequence = 0;
  const emit: Emit = (diagnostic, firstIndex) => {
    collected.push({ diagnostic, firstIndex, seq: sequence });
    sequence += 1;
  };

  const muted = options?.mutedRules;
  const runDuplicateKeys = !muted?.has('duplicate-key');
  // Both graph rules share one graph: it is built while either is unmuted.
  // `includeGraphRules: false` (the badge's graph-free pass, plan 18 D3/D4)
  // skips the recursion pass entirely — both graph rules AND the book-level
  // large-book skip note (which ships with rule 'recursion-cycle').
  const includeGraphRules = options?.includeGraphRules ?? true;
  const runRecursionGraph =
    includeGraphRules && (!muted?.has('recursion-cycle') || !muted?.has('self-trigger'));

  // The five entry-scoped rules are per-entry derivations sourced from
  // `entry-memo.ts` (memoized by entry identity, plan 18 D2). A muted
  // entry-scoped rule is filtered at emission — observably identical to the
  // old skip-before-check (the checks are memoized/cheap), while the
  // recursion graph keeps its genuine skip-before-build short-circuit.
  // Id-less entries bypass the memo (their diagnostics are index-based, so a
  // reorder would stale it); `memoEntryLint` evaluates `entryRefId` against
  // `entry.id`, which makes the index argument irrelevant for id-carrying
  // entries.
  for (const [index, entry] of entries.entries()) {
    const entryDiagnostics = entry.id != null ? memoEntryLint(entry) : lintEntryRules(entry, index);
    for (const diagnostic of entryDiagnostics) {
      if (muted?.has(diagnostic.rule)) {
        continue;
      }
      emit(diagnostic, index);
    }
  }
  if (runDuplicateKeys) {
    lintDuplicateKeys(entries, emit);
  }
  if (runRecursionGraph) {
    lintRecursion(entries, emit, muted);
  }

  // Ignored signatures suppress exactly the matching diagnostics (near-misses
  // stay); filtering precedes the sort, so the survivors keep the plain
  // pass's severity→entry-order order (plan 03 §3.6.5.1).
  const ignored = options?.ignored;
  return collected
    .filter(
      (item) => ignored === undefined || !ignored.has(lintDiagnosticSignature(item.diagnostic)),
    )
    .sort(
      (a, b) =>
        SEVERITY_RANK[a.diagnostic.severity] - SEVERITY_RANK[b.diagnostic.severity] ||
        a.firstIndex - b.firstIndex ||
        a.seq - b.seq,
    )
    .map((item) => item.diagnostic);
}

// ============================================================================
// Rule `duplicate-key`
// ============================================================================

/** One (enabled entry, key spelling) participant of a lowercase key bucket. */
interface KeyParticipant {
  readonly entry: CharacterBookEntry;
  readonly index: number;
  /** The key as written (first occurrence in the entry's key list). */
  readonly spelling: string;
  /** `case_sensitive === true` — the only setting that changes ST matching. */
  readonly caseSensitive: boolean;
  /** Trimmed `extensions.group`, `''` when unset. */
  readonly group: string;
}

/**
 * Rule `duplicate-key` (warning): the same primary key on 2+ enabled
 * entries. Comparison per pair: exact-case when BOTH entries set
 * `case_sensitive: true`, case-insensitive otherwise — ST resolves unset
 * against the global default `false`, so an entry without the flag collides
 * case-insensitively; for a mixed pair the non-case-sensitive entry still
 * collides under that fallback, so the pair compares case-insensitively
 * (documented behavior, pinned in linter.spec.ts). Blank keys never
 * duplicate. Entries sharing one non-empty `extensions.group` downgrade the
 * diagnostic to info — group scoring legitimately competes (§7.3).
 */
function lintDuplicateKeys(entries: readonly CharacterBookEntry[], emit: Emit): void {
  /** Buckets keyed by `toLowerCase` (ST's #transformString fold). */
  const buckets = new Map<string, KeyParticipant[]>();
  entries.forEach((entry, index) => {
    if (!entry.enabled) {
      return;
    }
    const ext = entryExt(entry);
    const group = extText(ext, 'group').trim();
    // An entry joins each bucket once even if its key list repeats a spelling.
    for (const spelling of new Set(entry.keys)) {
      if (spelling.trim() === '') {
        continue;
      }
      const bucketKey = spelling.toLowerCase();
      const bucket = buckets.get(bucketKey) ?? [];
      bucket.push({ entry, index, spelling, caseSensitive: entry.case_sensitive === true, group });
      buckets.set(bucketKey, bucket);
    }
  });

  for (const participants of buckets.values()) {
    if (participants.length < 2) {
      continue;
    }
    emitDuplicateComponents(participants, emit);
  }
}

/**
 * Groups a bucket's participants into maximal collision components and emits
 * one diagnostic per component of 2+. Two participants collide when their
 * spellings are equal, or when at least one of them is not case-sensitive.
 */
function emitDuplicateComponents(participants: KeyParticipant[], emit: Emit): void {
  const adjacency = new Map<KeyParticipant, KeyParticipant[]>(
    participants.map((participant) => [participant, []]),
  );
  for (const [i, a] of participants.entries()) {
    for (const [j, b] of participants.entries()) {
      if (j <= i) {
        continue;
      }
      if (a.spelling === b.spelling || !(a.caseSensitive && b.caseSensitive)) {
        adjacency.get(a)?.push(b);
        adjacency.get(b)?.push(a);
      }
    }
  }

  const visited = new Set<KeyParticipant>();
  const walk = (member: KeyParticipant, component: KeyParticipant[]): void => {
    if (visited.has(member)) {
      return;
    }
    visited.add(member);
    component.push(member);
    for (const next of adjacency.get(member) ?? []) {
      walk(next, component);
    }
  };

  for (const start of participants) {
    const component: KeyParticipant[] = [];
    walk(start, component);
    if (component.length < 2) {
      continue;
    }
    emitDuplicate(component, emit);
  }
}

/** Emits one duplicate-key diagnostic for a collision component. */
function emitDuplicate(component: KeyParticipant[], emit: Emit): void {
  // Entry order anchors sorting and message copy; an entry may appear twice
  // in one component (two spellings) — report each entry once.
  const ordered = [...component].sort((a, b) => a.index - b.index);
  const seen = new Set<number>();
  const members = ordered.filter((participant) => {
    if (seen.has(participant.index)) {
      return false;
    }
    seen.add(participant.index);
    return true;
  });

  const firstGroup = members[0]?.group ?? '';
  const sharedGroup = firstGroup !== '' && members.every((member) => member.group === firstGroup);
  // details carries the duplicated key as first written in book order.
  const details = ordered[0]?.spelling ?? '';

  emit(
    {
      rule: 'duplicate-key',
      severity: sharedGroup ? 'info' : 'warning',
      entryIds: members.map((member) => entryRefId(member.entry, member.index)),
      message: sharedGroup
        ? `Entries ${quotedList(members.map((m) => entryTitle(m.entry)))} share the primary key '${details}' — they compete for the same activation, but their shared extensions.group makes the tie intentional.`
        : `Entries ${quotedList(members.map((m) => entryTitle(m.entry)))} share the primary key '${details}' — they compete for the same activation.`,
      details,
    },
    members[0]?.index ?? 0,
  );
}

// ============================================================================
// Recursion graph — rules `recursion-cycle` and `self-trigger`
// ============================================================================

/** A graph vertex: one entry plus Tarjan's working state. */
interface RecursionNode {
  readonly entry: CharacterBookEntry;
  readonly entryIndex: number;
  readonly successors: RecursionNode[];
  tarjanIndex: number;
  lowlink: number;
  onStack: boolean;
}

/**
 * The graph rules: `self-trigger` (a node whose own content matches its own
 * keys — the graph's self-edge) and `recursion-cycle` (strongly connected
 * components of 2+ nodes). Above `LARGE_BOOK_THRESHOLD` both are skipped and
 * one `info` diagnostic notes the skip.
 *
 * The skip note reuses the `recursion-cycle` rule id because the frozen
 * §3.2 rule union has no book-level id; the message disambiguates. Muting
 * that rule therefore silences the note too — coherent by design (plan 03
 * §3.6.5.1, pinned in linter.spec.ts). Either rule muted alone keeps the
 * graph running for the other.
 */
function lintRecursion(
  entries: readonly CharacterBookEntry[],
  emit: Emit,
  muted: ReadonlySet<LintRuleId> | undefined,
): void {
  const reportCycles = !muted?.has('recursion-cycle');
  const reportSelfTriggers = !muted?.has('self-trigger');
  if (entries.length > LARGE_BOOK_THRESHOLD) {
    // The skip note ships with rule 'recursion-cycle' — muting that rule
    // silences it (plan 03 §3.6.5.1).
    if (reportCycles) {
      emit(
        {
          rule: 'recursion-cycle',
          severity: 'info',
          // Book-level diagnostic — it addresses no single entry.
          entryIds: [],
          message: `Lorebook has ${entries.length} entries — the recursion cycle and self-trigger checks are skipped above ${LARGE_BOOK_THRESHOLD} for performance.`,
        },
        0,
      );
    }
    return;
  }

  const nodes: RecursionNode[] = entries.map((entry, entryIndex) => ({
    entry,
    entryIndex,
    successors: [],
    tarjanIndex: -1,
    lowlink: 0,
    onStack: false,
  }));

  // Edge A→B (plan §3.2, verbatim): A enabled && !prevent_recursion (source
  // can propagate) && B enabled && !constant && !exclude_recursion (target is
  // recursion-activatable) && B has usable keys && a key of B matches A's
  // content with B's own match options. Whole content is scanned — a
  // conservative superset of ST's scan_depth window (§7.2), which is why the
  // copy says "may".
  //
  // Target eligibility and the per-key plans are invariant across sources, so
  // they are computed once per pass — not once per pair — keeping the O(V²)
  // pair loop free of per-key regex parsing and case folding. The filtered
  // list preserves entry order, so successors are pushed (and self-triggers
  // emitted) in exactly the unfiltered loop's order.
  interface RecursionTarget {
    readonly node: RecursionNode;
    readonly plan: TargetKeyPlan;
    readonly caseSensitive: boolean | undefined;
    readonly matchWholeWords: boolean | null;
  }
  const targets: RecursionTarget[] = [];
  for (const node of nodes) {
    if (!node.entry.enabled || node.entry.constant === true) {
      continue;
    }
    const ext = entryExt(node.entry);
    if (extFlag(ext, 'exclude_recursion') || !hasUsableKeys(node.entry.keys)) {
      continue;
    }
    targets.push({
      node,
      plan: prepareTargetKeys(node.entry),
      caseSensitive: node.entry.case_sensitive,
      matchWholeWords: extBoolOption(ext, 'match_whole_words'),
    });
  }

  for (const source of nodes) {
    if (!source.entry.enabled || extFlag(entryExt(source.entry), 'prevent_recursion')) {
      continue;
    }
    const content = (source.entry.content ?? '').slice(0, MATCH_CONTENT_CAP);
    // Folded once per source instead of once per pair/key (see
    // `firstMatchingKey` for why passing pre-folded input is equivalent).
    const foldedContent = content.toLowerCase();
    for (const target of targets) {
      const matched = firstMatchingKey(
        target.plan,
        content,
        foldedContent,
        target.caseSensitive,
        target.matchWholeWords,
      );
      if (matched === null) {
        continue;
      }
      source.successors.push(target.node);
      if (source === target.node && reportSelfTriggers) {
        // Self-edge: reported separately as `self-trigger`, never as a cycle.
        emit(
          {
            rule: 'self-trigger',
            severity: 'info',
            entryIds: [entryRefId(source.entry, source.entryIndex)],
            message: `Entry "${entryTitle(source.entry)}" content contains its own keys — it may activate itself during recursion.`,
            details: matched.trim() === '' ? undefined : matched,
          },
          source.entryIndex,
        );
      }
    }
  }

  if (!reportCycles) {
    return;
  }
  for (const component of stronglyConnectedComponents(nodes)) {
    if (component.length < 2) {
      continue;
    }
    emitCycle(component, emit);
  }
}

/**
 * Rule `recursion-cycle` (warning): one diagnostic per SCC of 2+ nodes,
 * `details` the entry-title path of an actual cycle within the SCC,
 * `entryIds` the cycle's members.
 */
function emitCycle(component: readonly RecursionNode[], emit: Emit): void {
  const path = cyclePathIn(component);
  const titles = path.map((node) => entryTitle(node.entry));
  emit(
    {
      rule: 'recursion-cycle',
      severity: 'warning',
      entryIds: path.map((node) => entryRefId(node.entry, node.entryIndex)),
      message: `Entries ${quotedList(titles)} may activate during recursion in a loop.`,
      details: [...titles, titles[0] ?? ''].join(' → '),
    },
    Math.min(...path.map((node) => node.entryIndex)),
  );
}

/**
 * Tarjan's strongly connected components (plan §3.2) over the recursion
 * graph. Recursive formulation: graph rules only run at or below
 * `LARGE_BOOK_THRESHOLD` entries, so recursion depth stays bounded by the
 * longest simple chain (~1500 frames — far inside the JS stack limit).
 * Returns components in discovery order; deterministic because successors
 * are pushed in entry order.
 */
function stronglyConnectedComponents(nodes: readonly RecursionNode[]): RecursionNode[][] {
  const stack: RecursionNode[] = [];
  const components: RecursionNode[][] = [];
  let counter = 0;

  const visit = (node: RecursionNode): void => {
    node.tarjanIndex = counter;
    node.lowlink = counter;
    counter += 1;
    stack.push(node);
    node.onStack = true;
    for (const successor of node.successors) {
      if (successor.tarjanIndex === -1) {
        visit(successor);
        node.lowlink = Math.min(node.lowlink, successor.lowlink);
      } else if (successor.onStack) {
        node.lowlink = Math.min(node.lowlink, successor.tarjanIndex);
      }
    }
    if (node.lowlink === node.tarjanIndex) {
      const component: RecursionNode[] = [];
      for (;;) {
        const member = stack.pop();
        // Unreachable: `node` itself is on the stack below this pop.
        if (member === undefined) {
          break;
        }
        member.onStack = false;
        component.push(member);
        if (member === node) {
          break;
        }
      }
      components.push(component);
    }
  };

  for (const node of nodes) {
    if (node.tarjanIndex === -1) {
      visit(node);
    }
  }
  return components;
}

/**
 * Finds a simple cycle through the SCC's lowest-index member by DFS within
 * the component (successors in entry order → deterministic first hit). An
 * SCC of 2+ is strongly connected, so a simple cycle through any member
 * exists and the search always closes; the sorted-members fallback is
 * unreachable but keeps the function total. Self-loops never close the path
 * (a cycle needs 2+ distinct members — self-edges are the `self-trigger`
 * rule's domain).
 */
function cyclePathIn(component: readonly RecursionNode[]): RecursionNode[] {
  const members = new Set(component);
  const ordered = [...component].sort((a, b) => a.entryIndex - b.entryIndex);
  const start = ordered[0];
  // Unreachable: callers only pass SCCs of 2+.
  if (start === undefined) {
    return ordered;
  }

  const path: RecursionNode[] = [start];
  const visited = new Set<RecursionNode>([start]);
  const walk = (current: RecursionNode): boolean => {
    for (const next of current.successors) {
      if (next === start) {
        // Closing through a 2+ member path ends the search; the start node's
        // own self-edge (path of 1) is skipped, not terminal — the SCC may
        // still hold a longer cycle through it.
        if (path.length >= 2) {
          return true;
        }
        continue;
      }
      if (!members.has(next) || visited.has(next)) {
        continue;
      }
      visited.add(next);
      path.push(next);
      if (walk(next)) {
        return true;
      }
      path.pop();
    }
    return false;
  };

  return walk(start) ? path : ordered;
}
