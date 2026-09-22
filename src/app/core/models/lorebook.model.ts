/**
 * LoreStitch core data model.
 *
 * The canonical editing format is the SillyTavern Character Book V2 schema.
 * Native SillyTavern world-info files (the `{ entries: { uid: {...} } }` shape
 * produced by `world-info.js`) are imported by converting them to
 * `CharacterBook`; the conversion mirrors SillyTavern's own
 * `convertCharacterBook()` so values survive a round trip.
 */

// ============================================================================
// SillyTavern Character Card V2 spec
// ============================================================================

/**
 * Legacy card metadata kept only so projects imported from character cards in
 * older LoreStitch versions still load. Card import/export is no longer a
 * feature; the field round-trips untouched in `.stproj` archives.
 */
export interface TavernCardV2 {
  spec: 'chara_card_v2';
  spec_version: '2.0';
  data: {
    name: string;
    description: string;
    personality: string;
    scenario: string;
    first_mes: string;
    mes_example: string;
    creator_notes: string;
    system_prompt: string;
    post_history_instructions: string;
    alternate_greetings: string[];
    character_book?: CharacterBook;
    tags: string[];
    creator: string;
    character_version: string;
    extensions: Record<string, unknown>;
  };
}

export interface CharacterBook {
  name?: string;
  description?: string;
  scan_depth?: number;
  token_budget?: number;
  recursive_scanning?: boolean;
  extensions: Record<string, unknown>;
  entries: CharacterBookEntry[];
}

export interface CharacterBookEntry {
  id?: number;
  name?: string;
  keys: string[];
  secondary_keys?: string[];
  content: string;
  comment?: string;
  enabled: boolean;
  insertion_order: number;
  priority?: number;
  position?: WiPosition;
  case_sensitive?: boolean;
  selective?: boolean;
  constant?: boolean;
  extensions: Record<string, unknown>;
}

// ============================================================================
// Insertion positions (every SillyTavern `world_info_position` value)
// ============================================================================

/**
 * UI-facing insertion positions. The V2 card spec only names `before_char` /
 * `after_char`; every other SillyTavern position is stored in the spec field
 * as its closest match and carried losslessly in `extensions.position`
 * (exactly how SillyTavern's own `convertCharacterBook()` round-trips them).
 */
export type WiPosition =
  | 'before_char'
  | 'after_char'
  | 'before_em'
  | 'after_em'
  | 'before_an'
  | 'after_an'
  | 'at_depth'
  | 'outlet';

/** Ordered like the World Info docs' "Insertion Position" list. */
export const WI_POSITION_OPTIONS: readonly {
  value: WiPosition;
  label: string;
  hint: string;
}[] = [
  {
    value: 'before_char',
    label: 'Before Char Defs',
    hint: 'Inserted before the character description & scenario — moderate impact',
  },
  {
    value: 'after_char',
    label: 'After Char Defs',
    hint: 'Inserted after the character description & scenario — greater impact',
  },
  {
    value: 'before_em',
    label: 'Before Example Messages',
    hint: 'Parsed as an example dialogue block before the card examples',
  },
  {
    value: 'after_em',
    label: 'After Example Messages',
    hint: 'Parsed as an example dialogue block after the card examples',
  },
  {
    value: 'before_an',
    label: 'Top of Author’s Note',
    hint: 'Inserted at the top of Author’s Note content',
  },
  {
    value: 'after_an',
    label: 'Bottom of Author’s Note',
    hint: 'Inserted at the bottom of Author’s Note content',
  },
  {
    value: 'at_depth',
    label: '@ Depth',
    hint: 'Inserted at a specific chat depth (0 = bottom of the prompt), as a system / user / assistant message',
  },
  {
    value: 'outlet',
    label: 'Outlet (manual)',
    hint: 'Not injected automatically — pull it into the prompt with the outlet macro',
  },
];

// ============================================================================
// Native SillyTavern world-info format (mirrors example_card/world-info.js)
// ============================================================================

/** `world_info_position` values from SillyTavern's world-info.js. */
export const ST_POSITION = {
  before: 0,
  after: 1,
  ANTop: 2,
  ANBottom: 3,
  atDepth: 4,
  EMTop: 5,
  EMBottom: 6,
  outlet: 7,
} as const;

/** `world_info_logic` values from SillyTavern's world-info.js. */
export const ST_LOGIC = {
  AND_ANY: 0,
  NOT_ALL: 1,
  NOT_ANY: 2,
  AND_ALL: 3,
} as const;

/** One of SillyTavern's `world_info_logic` values. */
export type StLogic = (typeof ST_LOGIC)[keyof typeof ST_LOGIC];

/** UI options for the secondary-keys logic selector, ordered like the ST docs. */
export const ST_LOGIC_OPTIONS: readonly [
  { value: StLogic; label: string },
  ...{ value: StLogic; label: string }[],
] = [
  { value: ST_LOGIC.AND_ANY, label: 'AND Any' },
  { value: ST_LOGIC.NOT_ALL, label: 'NOT All' },
  { value: ST_LOGIC.NOT_ANY, label: 'NOT Any' },
  { value: ST_LOGIC.AND_ALL, label: 'AND All' },
];

/**
 * `GENERATION_TYPE_TRIGGERS` from SillyTavern's script.js — the generation
 * types a per-entry `triggers` filter may restrict activation to. An empty
 * filter means the entry may activate for every type.
 */
export const ST_TRIGGERS = [
  'normal',
  'continue',
  'impersonate',
  'swipe',
  'regenerate',
  'quiet',
] as const;

export type StTrigger = (typeof ST_TRIGGERS)[number];

/** UI options for the per-entry trigger filter, ordered like the ST docs. */
export const ST_TRIGGER_OPTIONS: readonly { value: StTrigger; label: string; hint: string }[] = [
  { value: 'normal', label: '💬 Normal', hint: 'Regular message generation' },
  { value: 'continue', label: '⏩ Continue', hint: 'When the Continue button is pressed' },
  { value: 'impersonate', label: '🎭 Impersonate', hint: 'When Impersonate is pressed' },
  { value: 'swipe', label: '👉 Swipe', hint: 'When generation is triggered by swiping' },
  { value: 'regenerate', label: '🔁 Regenerate', hint: 'Regenerate in solo chats' },
  { value: 'quiet', label: '🌙 Quiet', hint: 'Background requests from extensions / scripts' },
];

/** Native per-entry character activation filter (SillyTavern's `characterFilter`). */
export interface StCharacterFilter {
  isExclude: boolean;
  names: string[];
  tags: string[];
}

/** LoreStitch-normalized `characterFilter`, stored in `extensions.character_filter`. */
export interface NormalizedCharacterFilter {
  is_exclude: boolean;
  names: string[];
  tags: string[];
}

/** `extension_prompt_roles` values from SillyTavern's script.js. */
export const ST_ROLE = {
  system: 0,
  user: 1,
  assistant: 2,
} as const;

/** One of SillyTavern's `extension_prompt_roles` values. */
export type StRole = (typeof ST_ROLE)[keyof typeof ST_ROLE];

/** UI options for the at-depth message role selector. */
export const ST_ROLE_OPTIONS: readonly { value: StRole; icon: string; label: string }[] = [
  { value: ST_ROLE.system, icon: '⚙️', label: 'System' },
  { value: ST_ROLE.user, icon: '👤', label: 'User' },
  { value: ST_ROLE.assistant, icon: '🤖', label: 'Assistant' },
];

/** `WiPosition` -> `world_info_position` numeric value. */
export const WI_POSITION_TO_ST: Record<WiPosition, number> = {
  before_char: ST_POSITION.before,
  after_char: ST_POSITION.after,
  before_em: ST_POSITION.EMTop,
  after_em: ST_POSITION.EMBottom,
  before_an: ST_POSITION.ANTop,
  after_an: ST_POSITION.ANBottom,
  at_depth: ST_POSITION.atDepth,
  outlet: ST_POSITION.outlet,
};

/** `world_info_position` numeric value -> `WiPosition` (unknown values fall back). */
export function stNumberToPosition(
  numeric: number | null | undefined,
  fallback: WiPosition = 'before_char',
): WiPosition {
  const match = (Object.keys(WI_POSITION_TO_ST) as WiPosition[]).find(
    (key) => WI_POSITION_TO_ST[key] === numeric,
  );
  return match ?? fallback;
}

/**
 * Current effective SillyTavern numeric position of an entry. The numeric
 * `extensions.position` mirror is authoritative when present — imports park
 * the raw value there and in-app position edits keep it in sync
 * (`EntryUpdatesService.setPosition`) — while the spec string is the fallback
 * for books that only carry it.
 */
export function entryStPosition(entry: CharacterBookEntry): number {
  const ext = (entry.extensions ?? {}) as Record<string, unknown>;
  const mirrored = ext['position'];
  if (typeof mirrored === 'number') {
    return mirrored;
  }
  const position = entry.position;
  if (position && position in WI_POSITION_TO_ST) {
    return WI_POSITION_TO_ST[position as WiPosition];
  }
  return ST_POSITION.before;
}

/**
 * Normalizes entries whose true position lives in `extensions.position`
 * (e.g. books exported from SillyTavern or older LoreStitch versions) so the
 * spec-level `position` field reflects the real value.
 */
export function normalizeBookPositions(book: CharacterBook): CharacterBook {
  return {
    ...book,
    entries: book.entries.map((entry) => {
      const ext = (entry.extensions ?? {}) as Record<string, unknown>;
      const mirrored = ext['position'];
      return typeof mirrored === 'number'
        ? {
            ...entry,
            position: stNumberToPosition(mirrored, (entry.position ?? 'before_char') as WiPosition),
          }
        : entry;
    }),
  };
}

// ============================================================================
// Trigger strategy (SillyTavern's constant / normal / vectorized tri-state)
// ============================================================================

/**
 * The "Strategy" selector from the World Info docs:
 * - `normal` (🟢) — triggered only in the presence of a key.
 * - `constant` (🔵) — needs no keywords, triggers regardless of content.
 * - `vectorized` (🔗) — additionally allowed to be inserted by embedding
 *   similarity (Vector Storage); still behaves like a normal entry otherwise.
 *
 * Stored across `constant` + `extensions.vectorized`, exactly like
 * SillyTavern's own `handleEntryStateSelectorHelper()`.
 */
export type WiTriggerState = 'normal' | 'constant' | 'vectorized';

/** Reads the tri-state trigger strategy of an entry (constant wins). */
export function entryTriggerState(entry: CharacterBookEntry): WiTriggerState {
  if (entry.constant) {
    return 'constant';
  }
  const ext = (entry.extensions ?? {}) as Record<string, unknown>;
  return ext['vectorized'] === true ? 'vectorized' : 'normal';
}

/**
 * Produces the entry patch for switching to `state`. The states are mutually
 * exclusive; other extension fields are preserved via `entry.extensions`.
 */
export function triggerStatePatch(
  entry: CharacterBookEntry,
  state: WiTriggerState,
): Partial<CharacterBookEntry> {
  return {
    constant: state === 'constant',
    extensions: { ...entry.extensions, vectorized: state === 'vectorized' },
  };
}

/**
 * The entry's generation-type trigger filter (`extensions.triggers`), with
 * unknown values dropped — an empty result means "activate for all types".
 */
export function entryTriggers(entry: CharacterBookEntry): StTrigger[] {
  const raw = (entry.extensions ?? {})['triggers'];
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((value): value is StTrigger =>
    (ST_TRIGGERS as readonly string[]).includes(value),
  );
}

/**
 * The entry's character activation filter (`extensions.character_filter`),
 * falling back to the legacy verbatim native object for books imported before
 * the field was normalized.
 */
export function entryCharacterFilter(entry: CharacterBookEntry): NormalizedCharacterFilter {
  const ext = (entry.extensions ?? {}) as Record<string, unknown>;
  const normalized = ext['character_filter'] as Partial<NormalizedCharacterFilter> | null;
  if (normalized && typeof normalized === 'object') {
    return {
      is_exclude: normalized.is_exclude ?? false,
      names: [...(normalized.names ?? [])],
      tags: [...(normalized.tags ?? [])],
    };
  }
  const legacy = ext['characterFilter'] as StCharacterFilter | null;
  if (legacy && typeof legacy === 'object') {
    return {
      is_exclude: legacy.isExclude ?? false,
      names: [...(legacy.names ?? [])],
      tags: [...(legacy.tags ?? [])],
    };
  }
  return { is_exclude: false, names: [], tags: [] };
}

/**
 * Parses a comma-separated character-name list into the normalized filter
 * shape: trimmed, de-duplicated, empty items dropped.
 */
export function parseNameList(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean),
    ),
  ];
}

/**
 * Produces a spec-clean book for V2 exports: `position` collapses to the two
 * spec-legal values (SillyTavern's own convention) while the true numeric
 * position is preserved in `extensions.position`.
 */
export function toSpecCompliantBook(book: CharacterBook): CharacterBook {
  return {
    ...structuredClone(book),
    entries: book.entries.map((entry) => ({
      ...entry,
      position: entryStPosition(entry) === ST_POSITION.before ? 'before_char' : 'after_char',
      extensions: { ...entry.extensions, position: entryStPosition(entry) },
    })),
  };
}

/**
 * A native SillyTavern world-info entry. SillyTavern tolerates unknown/legacy
 * fields on entries; the fields LoreStitch edits are normalized into
 * `CharacterBookEntry.extensions` (see `stNativeToCharacterBook`), everything
 * else — extension-derived attributes like `color` included — round-trips
 * untouched through `extensions` as well.
 */
export interface SillyTavernEntry {
  uid: number;
  key: string[];
  keysecondary?: string[];
  comment?: string;
  content: string;
  constant?: boolean;
  vectorized?: boolean;
  selective?: boolean;
  selectiveLogic?: number;
  addMemo?: boolean;
  order?: number;
  position?: number;
  disable?: boolean;
  excludeRecursion?: boolean;
  preventRecursion?: boolean;
  delayUntilRecursion?: boolean | number;
  probability?: number;
  useProbability?: boolean;
  depth?: number;
  outletName?: string;
  group?: string;
  groupOverride?: boolean;
  groupWeight?: number;
  scanDepth?: number | null;
  caseSensitive?: boolean | null;
  matchWholeWords?: boolean | null;
  useGroupScoring?: boolean | number | null;
  automationId?: string;
  role?: number | null;
  sticky?: number | null;
  cooldown?: number | null;
  delay?: number | null;
  triggers?: string[];
  displayIndex?: number;
  ignoreBudget?: boolean;
  matchPersonaDescription?: boolean;
  matchCharacterDescription?: boolean;
  matchCharacterPersonality?: boolean;
  matchCharacterDepthPrompt?: boolean;
  matchScenario?: boolean;
  matchCreatorNotes?: boolean;
  characterFilter?: StCharacterFilter | null;
  extensions?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Native SillyTavern world-info file shape: `{ entries: { "<uid>": entry } }`. */
export interface SillyTavernWorldInfo {
  entries: Record<string, SillyTavernEntry>;
  name?: string;
  description?: string;
  scan_depth?: number;
  token_budget?: number;
  recursive_scanning?: boolean;
  [key: string]: unknown;
}

// ============================================================================
// Lossless round-tripping of fields LoreStitch does not manage
// ============================================================================

/**
 * Top-level keys of a native world-info file the converters consume; every
 * other root key (`stlo`, `randomExtension`, …) is extension data that must
 * survive import and export untouched (stored in `book.extensions`).
 */
const ST_BOOK_RESERVED_KEYS: ReadonlySet<string> = new Set([
  'entries',
  'name',
  'description',
  'scan_depth',
  'token_budget',
  'recursive_scanning',
]);

/**
 * Top-level fields of a native entry the converters consume (keep in sync
 * with `SillyTavernEntry`). Anything else on an entry — e.g. attributes added
 * by SillyTavern extensions — is extension data.
 */
const ST_ENTRY_NATIVE_KEYS: ReadonlySet<string> = new Set([
  'uid',
  'key',
  'keysecondary',
  'comment',
  'content',
  'constant',
  'vectorized',
  'selective',
  'selectiveLogic',
  'addMemo',
  'order',
  'position',
  'disable',
  'excludeRecursion',
  'preventRecursion',
  'delayUntilRecursion',
  'probability',
  'useProbability',
  'depth',
  'outletName',
  'group',
  'groupOverride',
  'groupWeight',
  'scanDepth',
  'caseSensitive',
  'matchWholeWords',
  'useGroupScoring',
  'automationId',
  'role',
  'sticky',
  'cooldown',
  'delay',
  'triggers',
  'displayIndex',
  'ignoreBudget',
  'matchPersonaDescription',
  'matchCharacterDescription',
  'matchCharacterPersonality',
  'matchCharacterDepthPrompt',
  'matchScenario',
  'matchCreatorNotes',
  'characterFilter',
  'extensions',
]);

/**
 * The normalized `extensions` keys the converters map to native entry fields
 * (keep in sync with `EntryExtensions`). On export these are rewritten to
 * their native places, so they must never leak back as loose keys; everything
 * else found in `entry.extensions` is spread verbatim onto the native entry.
 */
const ST_ENTRY_EXTENSION_KEYS: ReadonlySet<string> = new Set<string>([
  'position',
  'native_add_memo',
  'exclude_recursion',
  'prevent_recursion',
  'delay_until_recursion',
  'display_index',
  'probability',
  'useProbability',
  'depth',
  'selectiveLogic',
  'outlet_name',
  'group',
  'group_override',
  'group_weight',
  'scan_depth',
  'case_sensitive',
  'match_whole_words',
  'use_group_scoring',
  'automation_id',
  'role',
  'vectorized',
  'sticky',
  'cooldown',
  'delay',
  'triggers',
  'ignore_budget',
  'match_persona_description',
  'match_character_description',
  'match_character_personality',
  'match_character_depth_prompt',
  'match_scenario',
  'match_creator_notes',
  'character_filter',
  'characterFilter',
  'native_extensions',
]);

/**
 * Unknown top-level entry keys — extension-derived attributes like `color` —
 * parked into the normalized `extensions` bag so import -> export preserves
 * them byte-for-byte. (Unknown keys inside the native entry's own
 * `extensions` object ride along inside the parked mirror instead, so they
 * are never written twice.)
 */
function stUnknownEntryExtensions(st: SillyTavernEntry): Record<string, unknown> {
  return Object.fromEntries(Object.entries(st).filter(([key]) => !ST_ENTRY_NATIVE_KEYS.has(key)));
}

/** Inverse of `stUnknownEntryExtensions` for the export direction. */
function unknownEntryExtensionKeys(ext: StNativeExtensions): [string, unknown][] {
  return Object.entries(ext).filter(([key]) => !ST_ENTRY_EXTENSION_KEYS.has(key));
}

/**
 * Reads an entry field: the native camelCase key always wins when present —
 * `null` included, since tri-states (`role`, `scanDepth`, …) use it to mean
 * "unset" and SillyTavern edits keep the camelCase key authoritative. The
 * normalized `extensions` mirror is only the fallback for books that carry a
 * value exclusively there.
 *
 * Hardened for untrusted imports: a stored value that fails the field's
 * `is` guard never reaches the typed mirror — the caller receives the
 * fallback (or a valid mirror value) while the raw value stays parked under
 * the extension key via `misTyped`, so exports restore it verbatim.
 */
function stEntryField<T>(
  st: SillyTavernEntry,
  nativeExtensions: Record<string, unknown>,
  camelKey: string,
  extKey: string,
  fallback: T,
  is: (value: unknown) => value is T,
  misTyped?: Record<string, unknown>,
): T {
  const camel = st[camelKey];
  if (is(camel)) {
    return camel;
  }
  const mirrored = nativeExtensions[extKey];
  if (mirrored !== undefined && mirrored !== null && is(mirrored)) {
    return mirrored;
  }
  if (camel !== undefined && misTyped && !(extKey in misTyped)) {
    misTyped[extKey] = camel;
  }
  return fallback;
}

/** Runtime guards for the normalized entry mirrors (see `stEntryField`). */
function isStNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isStBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function isStString(value: unknown): value is string {
  return typeof value === 'string';
}

function isStNumberOrNull(value: unknown): value is number | null {
  return value === null || isStNumber(value);
}

function isStBooleanOrNull(value: unknown): value is boolean | null {
  return value === null || isStBoolean(value);
}

function isStBooleanOrNumber(value: unknown): value is boolean | number {
  return isStBoolean(value) || isStNumber(value);
}

function isStBooleanOrNumberOrNull(value: unknown): value is boolean | number | null {
  return value === null || isStBooleanOrNumber(value);
}

function isStStringArray(value: unknown): value is string[] {
  return isStringArray(value);
}

function isStCharacterFilterOrNull(value: unknown): value is StCharacterFilter | null {
  return value === null || (typeof value === 'object' && value !== null);
}

// ============================================================================
// Import validation guards
// ============================================================================

/**
 * Plain-object guard shared by the import validators here and the archive
 * guards in `project.model.ts` (exported for the latter).
 */
export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/**
 * Structural guard for imported `CharacterBook` payloads. Only the critical
 * fields the editor indexes are enforced — every entry must be an object with
 * a string `content` and a string-array `keys` (a wrong-typed `keys` crashed
 * `entryTitle`); missing optional scalars are tolerated and filled by
 * `normalizeImportedBook` (normalization, not data loss).
 */
export function isCharacterBook(json: unknown): json is CharacterBook {
  if (!isJsonObject(json) || !Array.isArray(json['entries'])) {
    return false;
  }
  return json['entries'].every(
    (entry: unknown) =>
      isJsonObject(entry) && typeof entry['content'] === 'string' && isStringArray(entry['keys']),
  );
}

/**
 * Structural guard for native world-info imports: `entries` must be a
 * uid-keyed bag or bare array of plain objects. Per-entry fields are hardened
 * during conversion (`stEntryField`), so no deeper shape is required here.
 */
export function isSillyTavernWorldInfo(json: unknown): json is SillyTavernWorldInfo {
  if (!isJsonObject(json)) {
    return false;
  }
  const entries: unknown = json['entries'];
  if (Array.isArray(entries)) {
    return entries.every((entry: unknown) => isJsonObject(entry));
  }
  return (
    isJsonObject(entries) && Object.values(entries).every((entry: unknown) => isJsonObject(entry))
  );
}

/**
 * Fills the normalizable scalars `isCharacterBook` tolerates missing on
 * imported bare books (defaults, not data loss: every original key — known or
 * unknown — rides along untouched). Entries without an `id` receive a fresh
 * sequential one: the editor, batch selection and split export all key on
 * ids, so an id-less entry would otherwise be unaddressable.
 */
export function normalizeImportedBook(book: CharacterBook): CharacterBook {
  let nextId = book.entries.reduce((max, e) => Math.max(max, e.id ?? 0), -1) + 1;
  return {
    ...book,
    extensions: isJsonObject(book.extensions) ? book.extensions : {},
    entries: book.entries.map((entry) => {
      const raw = entry as unknown as Record<string, unknown>;
      const id = entry.id ?? nextId++;
      return {
        ...entry,
        id,
        extensions: isJsonObject(entry.extensions) ? entry.extensions : {},
        enabled: typeof raw['enabled'] === 'boolean' ? raw['enabled'] : true,
        insertion_order: typeof raw['insertion_order'] === 'number' ? raw['insertion_order'] : 100,
      };
    }),
  };
}

// ============================================================================
// Import format detection
// ============================================================================

export type LoreFileFormat = 'character_book' | 'sillytavern_native' | 'stproj';

interface LooseImportJson {
  format?: unknown;
  workspace?: unknown;
  entries?: unknown;
  stlo?: unknown;
}

/**
 * Detects whether a parsed JSON document is a bare `CharacterBook`, a
 * LoreStitch project archive, or a native SillyTavern world-info export.
 * Character cards are intentionally not recognized (card support was removed).
 */
export function detectLoreFileFormat(json: unknown): LoreFileFormat | null {
  if (json === null || typeof json !== 'object') {
    return null;
  }
  const obj = json as LooseImportJson;

  if (obj.format === 'lorestitch-project' && obj.workspace && typeof obj.workspace === 'object') {
    return 'stproj';
  }
  if (
    obj.entries &&
    typeof obj.entries === 'object' &&
    !Array.isArray(obj.entries) &&
    (obj.stlo !== undefined ||
      Object.values(obj.entries).every((e) => typeof e === 'object' && e !== null && 'uid' in e))
  ) {
    return 'sillytavern_native';
  }
  if (
    Array.isArray(obj.entries) &&
    obj.entries.every((e: unknown) => typeof e === 'object' && e !== null && 'content' in e)
  ) {
    return 'character_book';
  }
  return null;
}

/** Human-readable label for an entry, preferring comment/name then keys. */
export function entryTitle(entry: CharacterBookEntry): string {
  const title = entry.comment?.trim() || entry.name?.trim();
  if (title) {
    return title;
  }
  if (entry.keys.length) {
    return entry.keys.join(', ');
  }
  return `Entry ${entry.id ?? '?'}`;
}

// ============================================================================
// LoreStitch entry tags (curation metadata for batch tooling & filtering)
// ============================================================================

/**
 * Author-assigned category tags live in `extensions.lorestitch_tags` — a
 * LoreStitch-namespaced extension field, so native SillyTavern files are
 * never polluted and the values round-trip losslessly through the unknown
 * extension-key path of the converters.
 */
export const LORESTITCH_TAGS_EXTENSION_KEY = 'lorestitch_tags';

/** The entry's author-assigned tags (trimmed, de-duplicated, in order). */
export function entryTags(entry: CharacterBookEntry): string[] {
  const raw = (entry.extensions ?? {})[LORESTITCH_TAGS_EXTENSION_KEY];
  if (!Array.isArray(raw)) {
    return [];
  }
  return [
    ...new Set(
      raw
        .filter((tag): tag is string => typeof tag === 'string')
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  ];
}

/** Produces the extension patch replacing an entry's tag list. */
export function withEntryTags(
  entry: CharacterBookEntry,
  tags: string[],
): Partial<CharacterBookEntry> {
  const cleaned = [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
  return {
    extensions: { ...entry.extensions, [LORESTITCH_TAGS_EXTENSION_KEY]: cleaned },
  };
}

// ============================================================================
// Lorebook splitting (export a selection as a standalone book)
// ============================================================================

/**
 * Derives a standalone `CharacterBook` from a selection of the book's
 * entries, for "export selected entries as lorebook" workflows.
 *
 * Entries are deep-cloned with their full extension bags (vendor fields
 * included) and re-numbered `display_index`es; ids/uids are kept so merging
 * the split back later resolves collisions against the original uids.
 * Book-level extensions are intentionally NOT copied: parked vendor data
 * (`stlo`, …) belongs to the source file, while the split-off book is a new
 * artifact starting from a clean root.
 */
export function extractSubBook(
  book: CharacterBook,
  entryIds: readonly number[],
  name: string,
): CharacterBook {
  const ids = new Set(entryIds);
  const entries = book.entries
    .filter((entry) => entry.id !== undefined && ids.has(entry.id))
    .map((entry, index) => {
      const clone = structuredClone(entry);
      clone.extensions = { ...clone.extensions, display_index: index };
      return clone;
    });
  return {
    name,
    description: '',
    scan_depth: book.scan_depth,
    token_budget: book.token_budget,
    recursive_scanning: book.recursive_scanning,
    extensions: {},
    entries,
  };
}

/** Default extension payload carried on every new entry. */
function defaultEntryExtensions(): Record<string, unknown> {
  return {
    position: ST_POSITION.before,
    exclude_recursion: false,
    prevent_recursion: false,
    delay_until_recursion: false,
    display_index: 0,
    probability: 100,
    useProbability: true,
    depth: 4,
    selectiveLogic: ST_LOGIC.AND_ANY,
    group: '',
    group_override: false,
    group_weight: 100,
    scan_depth: null,
    match_whole_words: null,
    use_group_scoring: null,
    automation_id: '',
    role: ST_ROLE.system,
    vectorized: false,
    sticky: null,
    cooldown: null,
    delay: null,
    ignore_budget: false,
    triggers: [],
    match_persona_description: false,
    match_character_description: false,
    match_character_personality: false,
    match_character_depth_prompt: false,
    match_scenario: false,
    match_creator_notes: false,
    character_filter: null,
  };
}

/** Creates an empty `CharacterBook` in the default LoreStitch shape. */
export function createEmptyBook(name = 'New Lorebook'): CharacterBook {
  return {
    name,
    description: '',
    scan_depth: undefined,
    token_budget: undefined,
    recursive_scanning: false,
    extensions: {},
    entries: [],
  };
}

/** Creates a new entry with sensible SillyTavern-compatible defaults. */
export function createEmptyEntry(id: number, displayIndex = 0): CharacterBookEntry {
  return {
    id,
    name: '',
    keys: [],
    secondary_keys: [],
    content: '',
    comment: '',
    enabled: true,
    insertion_order: 100,
    priority: undefined,
    position: 'before_char',
    case_sensitive: undefined,
    selective: false,
    constant: false,
    extensions: { ...defaultEntryExtensions(), display_index: displayIndex },
  };
}

// ============================================================================
// Native SillyTavern <-> CharacterBook conversion
// ============================================================================

/** Normalizes a native `characterFilter` into `extensions.character_filter`. */
function stNativeToCharacterFilter(
  filter: StCharacterFilter | null | undefined,
): NormalizedCharacterFilter | null {
  if (!filter || typeof filter !== 'object') {
    return null;
  }
  return {
    is_exclude: filter.isExclude ?? false,
    names: Array.isArray(filter.names) ? [...filter.names] : [],
    tags: Array.isArray(filter.tags) ? [...filter.tags] : [],
  };
}

/**
 * Inverse of `stNativeToCharacterFilter`, tolerant of both the normalized
 * `extensions.character_filter` shape and the legacy verbatim native object.
 */
function toNativeCharacterFilter(value: unknown): StCharacterFilter | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const raw = value as {
    isExclude?: unknown;
    is_exclude?: unknown;
    names?: unknown;
    tags?: unknown;
  };
  const names = Array.isArray(raw.names) ? raw.names.filter((n) => typeof n === 'string') : [];
  const tags = Array.isArray(raw.tags) ? raw.tags.filter((t) => typeof t === 'string') : [];
  const isExclude =
    typeof raw.is_exclude === 'boolean' ? raw.is_exclude : ((raw.isExclude as boolean) ?? false);
  return { isExclude, names, tags };
}

/**
 * Converts a native SillyTavern world-info export into a `CharacterBook`.
 * Field names mirror the inverse of SillyTavern's `convertCharacterBook()`:
 * anything outside the V2 schema — extension data on the file root (`stlo`,
 * `randomExtension`, …) and on entries (`color`, unknown `extensions` keys,
 * …) — is preserved inside `extensions` bags so exports round-trip untouched.
 */
export function stNativeToCharacterBook(data: SillyTavernWorldInfo, name?: string): CharacterBook {
  const rawEntries: SillyTavernEntry[] = Array.isArray(data.entries)
    ? data.entries
    : Object.values(data.entries ?? {});

  const sorted = [...rawEntries].sort(
    (a, b) => (a.displayIndex ?? a.uid) - (b.displayIndex ?? b.uid),
  );

  const entries = sorted.map((st, index): CharacterBookEntry => {
    const nativeExtensions =
      st.extensions && typeof st.extensions === 'object' ? st.extensions : {};
    // Raw values whose stored type failed a field guard, parked under their
    // extension keys so exports restore them verbatim (spread last below).
    const misTyped: Record<string, unknown> = {};
    const read = <T>(
      camelKey: string,
      extKey: string,
      fallback: T,
      is: (value: unknown) => value is T,
    ): T => stEntryField(st, nativeExtensions, camelKey, extKey, fallback, is, misTyped);

    const position = read('position', 'position', ST_POSITION.before as number, isStNumber);
    const extensions: Record<string, unknown> = {
      ...stUnknownEntryExtensions(st),
      // The native entry's own normalized mirror (world-info.js persists one
      // per entry) rides along verbatim so exports stay byte-identical.
      ...(Object.keys(nativeExtensions).length
        ? { native_extensions: { ...nativeExtensions } }
        : {}),
      position,
      exclude_recursion: read('excludeRecursion', 'exclude_recursion', false, isStBoolean),
      prevent_recursion: read('preventRecursion', 'prevent_recursion', false, isStBoolean),
      delay_until_recursion: read(
        'delayUntilRecursion',
        'delay_until_recursion',
        false,
        isStBooleanOrNumber,
      ),
      display_index: read('displayIndex', 'display_index', index, isStNumber),
      probability: read('probability', 'probability', 100, isStNumber),
      useProbability: read('useProbability', 'useProbability', true, isStBoolean),
      depth: read('depth', 'depth', 4, isStNumber),
      selectiveLogic: read('selectiveLogic', 'selectiveLogic', ST_LOGIC.AND_ANY, isStNumber),
      outlet_name: read('outletName', 'outlet_name', '', isStString),
      group: read('group', 'group', '', isStString),
      group_override: read('groupOverride', 'group_override', false, isStBoolean),
      group_weight: read('groupWeight', 'group_weight', 100, isStNumber),
      scan_depth: read('scanDepth', 'scan_depth', null, isStNumberOrNull),
      case_sensitive: read('caseSensitive', 'case_sensitive', null, isStBooleanOrNull),
      match_whole_words: read('matchWholeWords', 'match_whole_words', null, isStBooleanOrNull),
      use_group_scoring: read(
        'useGroupScoring',
        'use_group_scoring',
        null,
        isStBooleanOrNumberOrNull,
      ),
      automation_id: read('automationId', 'automation_id', '', isStString),
      role: read('role', 'role', ST_ROLE.system, isStNumberOrNull),
      vectorized: read('vectorized', 'vectorized', false, isStBoolean),
      sticky: read('sticky', 'sticky', null, isStNumberOrNull),
      cooldown: read('cooldown', 'cooldown', null, isStNumberOrNull),
      delay: read('delay', 'delay', null, isStNumberOrNull),
      triggers: read('triggers', 'triggers', [] as string[], isStStringArray),
      ignore_budget: read('ignoreBudget', 'ignore_budget', false, isStBoolean),
      match_persona_description: read(
        'matchPersonaDescription',
        'match_persona_description',
        false,
        isStBoolean,
      ),
      match_character_description: read(
        'matchCharacterDescription',
        'match_character_description',
        false,
        isStBoolean,
      ),
      match_character_personality: read(
        'matchCharacterPersonality',
        'match_character_personality',
        false,
        isStBoolean,
      ),
      match_character_depth_prompt: read(
        'matchCharacterDepthPrompt',
        'match_character_depth_prompt',
        false,
        isStBoolean,
      ),
      match_scenario: read('matchScenario', 'match_scenario', false, isStBoolean),
      match_creator_notes: read('matchCreatorNotes', 'match_creator_notes', false, isStBoolean),
      character_filter: stNativeToCharacterFilter(
        read(
          'characterFilter',
          'character_filter',
          null as StCharacterFilter | null,
          isStCharacterFilterOrNull,
        ),
      ),
      // Original addMemo flag, captured verbatim at import; the exported value
      // prefers it over the comment-derived synthesis (see
      // `characterBookToStNative`). Absent on fresh in-app entries.
      ...(typeof st.addMemo === 'boolean' ? { native_add_memo: st.addMemo } : {}),
      // Wrong-typed stored values keep their raw bytes under the extension
      // keys; the typed mirrors above hold the safe defaults.
      ...misTyped,
    };

    return {
      id: typeof st.uid === 'number' ? st.uid : undefined,
      name: typeof st.comment === 'string' ? st.comment || '' : '',
      keys: isStringArray(st.key) ? [...st.key] : [],
      secondary_keys: isStringArray(st.keysecondary) ? [...st.keysecondary] : [],
      content: typeof st.content === 'string' ? st.content : '',
      comment: typeof st.comment === 'string' ? st.comment : '',
      enabled: !(typeof st.disable === 'boolean' ? st.disable : false),
      insertion_order: typeof st.order === 'number' ? st.order : 100,
      priority: undefined,
      position: stNumberToPosition(position),
      case_sensitive: typeof st.caseSensitive === 'boolean' ? st.caseSensitive : undefined,
      selective: st.selective === true,
      constant: st.constant === true,
      extensions,
    };
  });

  return {
    name: name ?? data.name ?? 'Imported Lorebook',
    description: data.description ?? '',
    scan_depth: data.scan_depth ?? undefined,
    token_budget: data.token_budget ?? undefined,
    recursive_scanning: data.recursive_scanning ?? false,
    extensions: Object.fromEntries(
      Object.entries(data).filter(([k]) => !ST_BOOK_RESERVED_KEYS.has(k)),
    ),
    entries,
  };
}

/**
 * The normalized extension fields LoreStitch maintains on every entry.
 * Third-party fields are preserved as-is outside this shape (the native view
 * below adds an index signature), so imports round-trip untouched.
 */
export interface EntryExtensions {
  position?: number;
  /** Original native `addMemo` flag captured at import (exported verbatim). */
  native_add_memo?: boolean;
  vectorized?: boolean;
  selectiveLogic?: number;
  exclude_recursion?: boolean;
  prevent_recursion?: boolean;
  delay_until_recursion?: boolean | number;
  probability?: number;
  useProbability?: boolean;
  depth?: number;
  outlet_name?: string;
  group?: string;
  group_override?: boolean;
  group_weight?: number;
  scan_depth?: number | null;
  case_sensitive?: boolean | null;
  match_whole_words?: boolean | null;
  use_group_scoring?: boolean | number | null;
  automation_id?: string;
  role?: number | null;
  sticky?: number | null;
  cooldown?: number | null;
  delay?: number | null;
  triggers?: string[];
  display_index?: number;
  ignore_budget?: boolean;
  match_persona_description?: boolean;
  match_character_description?: boolean;
  match_character_personality?: boolean;
  match_character_depth_prompt?: boolean;
  match_scenario?: boolean;
  match_creator_notes?: boolean;
  character_filter?: NormalizedCharacterFilter | null;
}

/** Names of the normalized extension fields (type-checked in templates). */
export type EntryExtensionKey = keyof EntryExtensions;

/** `CharacterBookEntry.extensions` as the native SillyTavern conversion sees it. */
export type StNativeExtensions = EntryExtensions & Record<string, unknown>;

/**
 * Reads a match flag that was normalized in a later version: books imported
 * before normalization carry only the verbatim camelCase native key.
 */
function legacyFlag(ext: StNativeExtensions, normalized: string, legacy: string): boolean {
  const value = ext[normalized] ?? ext[legacy];
  return typeof value === 'boolean' ? value : false;
}

/**
 * Converts a `CharacterBook` back to the native SillyTavern world-info shape,
 * compatible with direct import into SillyTavern. Extension data parked in
 * `extensions` bags at import time (book-level `stlo` / `randomExtension`,
 * entry-level extras like `color`) is written back verbatim.
 */
export function characterBookToStNative(book: CharacterBook): SillyTavernWorldInfo {
  const entries: Record<string, SillyTavernEntry> = {};
  book.entries.forEach((entry, index) => {
    const ext = (entry.extensions ?? {}) as StNativeExtensions;
    const uid = entry.id ?? index;
    // The numeric `extensions.position` mirror is authoritative — imports park
    // the raw value there (including out-of-enum numbers like 99) and in-app
    // position edits keep it in sync — while the spec string is the fallback
    // for books that only carry it.
    const position =
      typeof ext.position === 'number'
        ? ext.position
        : entry.position && entry.position in WI_POSITION_TO_ST
          ? WI_POSITION_TO_ST[entry.position as WiPosition]
          : ST_POSITION.before;

    // Written only when the filter was configured, like SillyTavern itself.
    const characterFilter = toNativeCharacterFilter(ext.character_filter ?? ext['characterFilter']);
    // Entries imported from SillyTavern keep their original addMemo flag
    // verbatim; fresh in-app entries derive it from comment presence.
    const capturedAddMemo = ext['native_add_memo'];

    entries[String(uid)] = {
      // Extension-derived attributes round-trip at the native top level;
      // known fields below always win over any stale parked copies.
      ...Object.fromEntries(unknownEntryExtensionKeys(ext)),
      uid,
      key: entry.keys ?? [],
      keysecondary: entry.secondary_keys ?? [],
      comment: entry.comment ?? '',
      content: entry.content ?? '',
      constant: entry.constant ?? false,
      vectorized: ext.vectorized ?? false,
      selective: entry.selective ?? false,
      selectiveLogic: ext.selectiveLogic ?? ST_LOGIC.AND_ANY,
      addMemo:
        typeof capturedAddMemo === 'boolean' ? capturedAddMemo : !!(entry.comment ?? '').trim(),
      order: entry.insertion_order ?? 100,
      position,
      disable: !entry.enabled,
      excludeRecursion: ext.exclude_recursion ?? false,
      preventRecursion: ext.prevent_recursion ?? false,
      delayUntilRecursion: ext.delay_until_recursion ?? false,
      probability: ext.probability ?? 100,
      useProbability: ext.useProbability ?? true,
      depth: ext.depth ?? 4,
      outletName: ext.outlet_name ?? '',
      group: ext.group ?? '',
      groupOverride: ext.group_override ?? false,
      groupWeight: ext.group_weight ?? 100,
      scanDepth: ext.scan_depth ?? null,
      caseSensitive: entry.case_sensitive ?? ext.case_sensitive ?? null,
      matchWholeWords: ext.match_whole_words ?? null,
      useGroupScoring: ext.use_group_scoring ?? null,
      automationId: ext.automation_id ?? '',
      // ST-native files use `null` for "not at depth"; keep it instead of
      // coercing to system so imports round-trip untouched.
      role: ext.role ?? null,
      sticky: ext.sticky ?? null,
      cooldown: ext.cooldown ?? null,
      delay: ext.delay ?? null,
      triggers: ext.triggers ?? [],
      ignoreBudget: ext.ignore_budget ?? false,
      displayIndex: ext.display_index ?? index,
      matchPersonaDescription: legacyFlag(
        ext,
        'match_persona_description',
        'matchPersonaDescription',
      ),
      matchCharacterDescription: legacyFlag(
        ext,
        'match_character_description',
        'matchCharacterDescription',
      ),
      matchCharacterPersonality: legacyFlag(
        ext,
        'match_character_personality',
        'matchCharacterPersonality',
      ),
      matchCharacterDepthPrompt: legacyFlag(
        ext,
        'match_character_depth_prompt',
        'matchCharacterDepthPrompt',
      ),
      matchScenario: legacyFlag(ext, 'match_scenario', 'matchScenario'),
      matchCreatorNotes: legacyFlag(ext, 'match_creator_notes', 'matchCreatorNotes'),
      ...(characterFilter ? { characterFilter } : {}),
      // Imported entries that carried SillyTavern's per-entry normalized
      // `extensions` mirror get it back verbatim (untracked edits live in the
      // native fields above, which stay authoritative).
      ...(ext['native_extensions'] &&
      typeof ext['native_extensions'] === 'object' &&
      Object.keys(ext['native_extensions']).length
        ? { extensions: ext['native_extensions'] as Record<string, unknown> }
        : {}),
    };
  });

  // Extension metadata parked on the book root (stlo, randomExtension, …)
  // rides along unmanaged; `entries` itself can never come from the bag.
  const bookExtensions = book.extensions ?? {};
  const { entries: _ignored, ...extensionData } = bookExtensions as Record<string, unknown>;

  return {
    entries,
    ...(book.name ? { name: book.name } : {}),
    ...(book.description ? { description: book.description } : {}),
    ...(book.scan_depth !== undefined ? { scan_depth: book.scan_depth } : {}),
    ...(book.token_budget !== undefined ? { token_budget: book.token_budget } : {}),
    ...(book.recursive_scanning !== undefined
      ? { recursive_scanning: book.recursive_scanning }
      : {}),
    ...extensionData,
  };
}
