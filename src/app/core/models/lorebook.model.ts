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

export type TavernCardV2 = {
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
    alternate_greetings: Array<string>;
    character_book?: CharacterBook;
    tags: Array<string>;
    creator: string;
    character_version: string;
    extensions: Record<string, any>;
  };
};

export type CharacterBook = {
  name?: string;
  description?: string;
  scan_depth?: number;
  token_budget?: number;
  recursive_scanning?: boolean;
  extensions: Record<string, any>;
  entries: Array<CharacterBookEntry>;
};

export type CharacterBookEntry = {
  id?: number;
  name?: string;
  keys: Array<string>;
  secondary_keys?: Array<string>;
  content: string;
  comment?: string;
  enabled: boolean;
  insertion_order: number;
  priority?: number;
  position?: 'before_char' | 'after_char';
  case_sensitive?: boolean;
  selective?: boolean;
  constant?: boolean;
  extensions: Record<string, any>;
};

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

/** `extension_prompt_roles` values from SillyTavern's script.js. */
export const ST_ROLE = {
  system: 0,
  user: 1,
  assistant: 2,
} as const;

/**
 * A native SillyTavern world-info entry. SillyTavern tolerates unknown/legacy
 * fields on entries, so extra properties are preserved via the index
 * signature and stored back into `CharacterBookEntry.extensions`.
 */
export interface SillyTavernEntry {
  uid: number;
  key: Array<string>;
  keysecondary?: Array<string>;
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
  useGroupScoring?: number | null;
  automationId?: string;
  role?: number | null;
  sticky?: number | null;
  cooldown?: number | null;
  delay?: number | null;
  triggers?: Array<string>;
  displayIndex?: number;
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

/**
 * Detects whether a parsed JSON document is a bare `CharacterBook`, a
 * `TavernCardV2`, a LoreStitch project archive, or a native SillyTavern
 * world-info export.
 */
export function detectLoreFileFormat(json: unknown): LoreFileFormat | null {
  if (json === null || typeof json !== 'object') {
    return null;
  }
  const obj: any = json;

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
    typeof obj.entries === 'object' &&
    obj.entries.every((e: any) => typeof e === 'object' && e !== null && 'content' in e)
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
function defaultEntryExtensions(): Record<string, any> {
  return {
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
    const extensions: Record<string, any> = {
      // Unknown/extra native fields survive a round trip via extensions.
      ...Object.fromEntries(Object.entries(st).filter(([k]) => ST_PASSTHROUGH_FIELDS.has(k))),
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
      ignore_budget: (st as any).ignoreBudget ?? false,
      match_persona_description: (st as any).matchPersonaDescription ?? false,
      match_character_description: (st as any).matchCharacterDescription ?? false,
      match_character_personality: (st as any).matchCharacterPersonality ?? false,
      match_character_depth_prompt: (st as any).matchCharacterDepthPrompt ?? false,
      match_scenario: (st as any).matchScenario ?? false,
      match_creator_notes: (st as any).matchCreatorNotes ?? false,
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
      position: position === ST_POSITION.before ? 'before_char' : 'after_char',
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
 * Converts a `CharacterBook` back to the native SillyTavern world-info shape,
 * compatible with direct import into SillyTavern.
 */
export function characterBookToStNative(book: CharacterBook): SillyTavernWorldInfo {
  const entries: Record<string, SillyTavernEntry> = {};
  book.entries.forEach((entry, index) => {
    // Extension payloads are schema-free; alias as any so index-signature
    // members can be read with property access below.
    const ext: any = entry.extensions ?? {};
    const uid = entry.id ?? index;
    const position =
      typeof ext.position === 'number'
        ? ext.position
        : entry.position === 'after_char'
          ? ST_POSITION.after
          : ST_POSITION.before;

    const passthrough = Object.fromEntries(
      Object.entries(ext).filter(([k]) => ST_PASSTHROUGH_FIELDS.has(k)),
    );

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
      ...passthrough,
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

/**
 * Native world-info fields that are copied verbatim into `extensions` when
 * converting to a `CharacterBook` (they have no V2 schema counterpart), and
 * copied back out when exporting to the native format.
 */
const ST_PASSTHROUGH_FIELDS = new Set([
  'characterFilter',
  'matchPersonaDescription',
  'matchCharacterDescription',
  'matchCharacterPersonality',
  'matchCharacterDepthPrompt',
  'matchScenario',
  'matchCreatorNotes',
]);

/** Extracts the raw card metadata (everything except `character_book`). */
export function extractRawCardData(card: TavernCardV2): ProjectWorkspace['rawCardData'] {
  const { character_book: _characterBook, ...raw } = card.data;
  return raw;
}
