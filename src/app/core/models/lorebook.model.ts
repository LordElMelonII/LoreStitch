/**
 * LoreStitch core data model.
 *
 * The canonical editing format is the SillyTavern Character Book V2 schema
 * (`spec: 'chara_card_v2'`). Native SillyTavern world-info files (the
 * `{ entries: { uid: {...} } }` shape produced by `world-info.js`) are
 * imported by converting them to `CharacterBook`; the conversion mirrors
 * SillyTavern's own `convertCharacterBook()` so values survive a round trip.
 */

// ============================================================================
// SillyTavern Character Card V2 spec
// ============================================================================

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
// LoreStitch version-control model
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
  targetType: 'standalone_lorebook' | 'tavern_card_v2';
  rawCardData?: Omit<TavernCardV2['data'], 'character_book'>;
  activeBook: CharacterBook;
  headCommitId: string | null;
  commits: ProjectCommit[];
}

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
export const ST_LOGIC_OPTIONS: readonly { value: StLogic; label: string }[] = [
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

/** Current effective SillyTavern numeric position of an entry. */
export function entryStPosition(entry: CharacterBookEntry): number {
  const position = entry.position;
  if (position && position in WI_POSITION_TO_ST) {
    return WI_POSITION_TO_ST[position as WiPosition];
  }
  const ext = (entry.extensions ?? {}) as Record<string, unknown>;
  return typeof ext['position'] === 'number' ? (ext['position'] as number) : ST_POSITION.before;
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
      return typeof ext['position'] === 'number'
        ? {
            ...entry,
            position: stNumberToPosition(
              ext['position'] as number,
              (entry.position ?? 'before_char') as WiPosition,
            ),
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
export function toSpecCompliantBook(book: CharacterBook): CharacterBook {  return {
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
 * `CharacterBookEntry.extensions` (see `stNativeToCharacterBook`), the rest
 * are ignored.
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
// Import format detection
// ============================================================================

export type LoreFileFormat = 'character_book' | 'tavern_card_v2' | 'sillytavern_native' | 'stproj';

interface LooseImportJson {
  format?: unknown;
  workspace?: unknown;
  spec?: unknown;
  data?: unknown;
  entries?: unknown;
  stlo?: unknown;
}

/**
 * Detects whether a parsed JSON document is a bare `CharacterBook`, a
 * `TavernCardV2`, a LoreStitch project archive, or a native SillyTavern
 * world-info export.
 */
export function detectLoreFileFormat(json: unknown): LoreFileFormat | null {
  if (json === null || typeof json !== 'object') {
    return null;
  }
  const obj = json as LooseImportJson;

  if (obj.format === 'lorestitch-project' && obj.workspace && typeof obj.workspace === 'object') {
    return 'stproj';
  }
  if (obj.spec === 'chara_card_v2' && obj.data && typeof obj.data === 'object') {
    return 'tavern_card_v2';
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

/** Rough token estimate used across the UI (same heuristic as the editor). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
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
 * anything outside the V2 schema is preserved inside `extensions`.
 */
export function stNativeToCharacterBook(data: SillyTavernWorldInfo, name?: string): CharacterBook {
  const rawEntries: SillyTavernEntry[] = Array.isArray(data.entries)
    ? data.entries
    : Object.values(data.entries ?? {});

  const sorted = [...rawEntries].sort(
    (a, b) => (a.displayIndex ?? a.uid) - (b.displayIndex ?? b.uid),
  );

  const entries = sorted.map((st, index): CharacterBookEntry => {
    const position = st.position ?? ST_POSITION.before;
    const extensions: Record<string, unknown> = {
      position,
      exclude_recursion: st.excludeRecursion ?? false,
      prevent_recursion: st.preventRecursion ?? false,
      delay_until_recursion: st.delayUntilRecursion ?? false,
      display_index: st.displayIndex ?? index,
      probability: st.probability ?? 100,
      useProbability: st.useProbability ?? true,
      depth: st.depth ?? 4,
      selectiveLogic: st.selectiveLogic ?? ST_LOGIC.AND_ANY,
      outlet_name: st.outletName ?? '',
      group: st.group ?? '',
      group_override: st.groupOverride ?? false,
      group_weight: st.groupWeight ?? 100,
      scan_depth: st.scanDepth ?? null,
      case_sensitive: st.caseSensitive ?? null,
      match_whole_words: st.matchWholeWords ?? null,
      use_group_scoring: st.useGroupScoring ?? null,
      automation_id: st.automationId ?? '',
      role: st.role ?? ST_ROLE.system,
      vectorized: st.vectorized ?? false,
      sticky: st.sticky ?? null,
      cooldown: st.cooldown ?? null,
      delay: st.delay ?? null,
      triggers: st.triggers ?? [],
      ignore_budget: st.ignoreBudget ?? false,
      match_persona_description: st.matchPersonaDescription ?? false,
      match_character_description: st.matchCharacterDescription ?? false,
      match_character_personality: st.matchCharacterPersonality ?? false,
      match_character_depth_prompt: st.matchCharacterDepthPrompt ?? false,
      match_scenario: st.matchScenario ?? false,
      match_creator_notes: st.matchCreatorNotes ?? false,
      character_filter: stNativeToCharacterFilter(st.characterFilter),
    };

    return {
      id: st.uid,
      name: st.comment || '',
      keys: st.key ?? [],
      secondary_keys: st.keysecondary ?? [],
      content: st.content ?? '',
      comment: st.comment ?? '',
      enabled: !(st.disable ?? false),
      insertion_order: st.order ?? 100,
      priority: undefined,
      position: stNumberToPosition(position),
      case_sensitive: st.caseSensitive ?? undefined,
      selective: st.selective ?? false,
      constant: st.constant ?? false,
      extensions,
    };
  });

  return {
    name: name ?? data.name ?? 'Imported Lorebook',
    description: data.description ?? '',
    scan_depth: data.scan_depth ?? undefined,
    token_budget: data.token_budget ?? undefined,
    recursive_scanning: data.recursive_scanning ?? false,
    extensions: Object.fromEntries(Object.entries(data).filter(([k]) => k === 'stlo')),
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
 * compatible with direct import into SillyTavern.
 */
export function characterBookToStNative(book: CharacterBook): SillyTavernWorldInfo {
  const entries: Record<string, SillyTavernEntry> = {};
  book.entries.forEach((entry, index) => {
    const ext = (entry.extensions ?? {}) as StNativeExtensions;
    const uid = entry.id ?? index;
    // The spec-level string is canonical; extensions.position is the ST-native
    // numeric mirror (also the fallback for unknown/legacy values).
    const position =
      entry.position && entry.position in WI_POSITION_TO_ST
        ? WI_POSITION_TO_ST[entry.position as WiPosition]
        : typeof ext.position === 'number'
          ? ext.position
          : ST_POSITION.before;

    // Written only when the filter was configured, like SillyTavern itself.
    const characterFilter = toNativeCharacterFilter(ext.character_filter ?? ext['characterFilter']);

    entries[String(uid)] = {
      uid,
      key: entry.keys ?? [],
      keysecondary: entry.secondary_keys ?? [],
      comment: entry.comment ?? '',
      content: entry.content ?? '',
      constant: entry.constant ?? false,
      vectorized: ext.vectorized ?? false,
      selective: entry.selective ?? false,
      selectiveLogic: ext.selectiveLogic ?? ST_LOGIC.AND_ANY,
      addMemo: !!(entry.comment ?? '').trim(),
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
      role: ext.role ?? ST_ROLE.system,
      sticky: ext.sticky ?? null,
      cooldown: ext.cooldown ?? null,
      delay: ext.delay ?? null,
      triggers: ext.triggers ?? [],
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
    };
  });

  return {
    entries,
    ...(book.name ? { name: book.name } : {}),
    ...(book.description ? { description: book.description } : {}),
    ...(book.scan_depth !== undefined ? { scan_depth: book.scan_depth } : {}),
    ...(book.token_budget !== undefined ? { token_budget: book.token_budget } : {}),
    ...(book.recursive_scanning !== undefined
      ? { recursive_scanning: book.recursive_scanning }
      : {}),
  };
}

/** Extracts the raw card metadata (everything except `character_book`). */
export function extractRawCardData(card: TavernCardV2): ProjectWorkspace['rawCardData'] {
  const { character_book: _characterBook, ...raw } = card.data;
  return raw;
}
