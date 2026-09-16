import {
  type CharacterBookEntry,
  type StLogic,
  type StRole,
  ST_ROLE,
  WI_POSITION_TO_ST,
  type WiPosition,
  type WiTriggerState,
  entryTags,
  withEntryTags,
} from '../../core/models/lorebook.model';

/**
 * Pure batch-edit semantics shared by the batch operations dialog and its
 * tests: the dialog collects user intent into a `BatchOperations` object and
 * every entry patch is derived here, framework-free.
 *
 * A field left `undefined` (or a sub-mode of `'unchanged'`) means "leave
 * untouched", so a batch run only writes what the operator explicitly set.
 */

/** Insertion-order edit: set every entry to `amount`, or shift it by `amount`. */
export interface OrderOperation {
  mode: 'set' | 'shift';
  amount: number;
}

/** Per-entry scan-depth override: set a value, or clear back to "inherit". */
export interface ScanDepthOperation {
  mode: 'set' | 'clear';
  value: number;
}

/**
 * Insertion-position edit with its per-position arguments: `depth` and
 * `role` apply to `at_depth` only, `outletName` to `outlet` only. Other
 * positions are set as-is (SillyTavern only reads role at chat depth).
 */
export interface PositionOperation {
  position: WiPosition;
  depth?: number;
  role?: StRole;
  outletName?: string;
}

/**
 * One batch run's collected changes. `caseSensitive: null` clears the
 * per-entry override (back to the book-wide default); `addTags`/`removeTags`
 * are applied to each entry's existing tag list.
 */
export interface BatchOperations {
  enabled?: boolean;
  /** Trigger strategy: normal 🟢 / constant 🔵 / vectorized 🔗. */
  triggerState?: WiTriggerState;
  insertionOrder?: OrderOperation;
  scanDepth?: ScanDepthOperation;
  caseSensitive?: boolean | null;
  selectiveLogic?: StLogic;
  position?: PositionOperation;
  addTags?: string[];
  removeTags?: string[];
}

/**
 * The patch one entry receives for this batch run, or null when the
 * operations leave that entry untouched (nothing to write — also used to
 * count the affected entries for the apply button).
 */
export function buildBatchPatch(
  entry: CharacterBookEntry,
  ops: BatchOperations,
): Partial<CharacterBookEntry> | null {
  const patch: Partial<CharacterBookEntry> = {};
  const extensions: Record<string, unknown> = { ...entry.extensions };

  if (ops.enabled !== undefined) {
    patch.enabled = ops.enabled;
  }
  if (ops.triggerState !== undefined) {
    // The tri-state strategy mirrors SillyTavern's constant/vectorized
    // handling (`triggerStatePatch`): states are mutually exclusive, other
    // extension fields stay untouched.
    patch.constant = ops.triggerState === 'constant';
    extensions['vectorized'] = ops.triggerState === 'vectorized';
  }

  if (ops.insertionOrder) {
    const base = entry.insertion_order ?? 100;
    patch.insertion_order =
      ops.insertionOrder.mode === 'set'
        ? ops.insertionOrder.amount
        : base + ops.insertionOrder.amount;
  }

  if (ops.scanDepth) {
    extensions['scan_depth'] = ops.scanDepth.mode === 'set' ? ops.scanDepth.value : null;
  }

  if (ops.caseSensitive !== undefined) {
    // Spec field drives the native export; the extension mirror is kept in
    // sync exactly like the entry editor's case-sensitivity toggle.
    patch.case_sensitive = ops.caseSensitive ?? undefined;
    extensions['case_sensitive'] = ops.caseSensitive;
  }

  if (ops.selectiveLogic !== undefined) {
    extensions['selectiveLogic'] = ops.selectiveLogic;
  }

  if (ops.position) {
    patch.position = ops.position.position;
    extensions['position'] = WI_POSITION_TO_ST[ops.position.position];
    if (ops.position.position === 'at_depth') {
      extensions['depth'] = ops.position.depth ?? 4;
      extensions['role'] = ops.position.role ?? ST_ROLE.system;
    }
    if (ops.position.position === 'outlet') {
      extensions['outlet_name'] = ops.position.outletName?.trim() ?? '';
    }
  }

  if (ops.addTags?.length || ops.removeTags?.length) {
    const existing = entryTags(entry);
    const updated = new Set(existing);
    for (const tag of ops.addTags ?? []) {
      updated.add(tag);
    }
    for (const tag of ops.removeTags ?? []) {
      updated.delete(tag);
    }
    const updatedList = [...updated];
    // Value-compare: a fresh array would always defeat the reference-based
    // shallowEquals below and turn no-op tag runs into rewrites.
    if (JSON.stringify(updatedList) !== JSON.stringify(existing)) {
      Object.assign(extensions, withEntryTags(entry, updatedList).extensions);
    }
  }

  // Drop scalar writes that would not change the entry, so "disable" on an
  // already-disabled entry counts as untouched.
  for (const key of Object.keys(patch) as (keyof CharacterBookEntry)[]) {
    if (patch[key] === entry[key]) {
      delete patch[key];
    }
  }
  const extensionsChanged = !shallowEquals(extensions, entry.extensions ?? {});
  if (!Object.keys(patch).length && !extensionsChanged) {
    return null;
  }
  return { ...patch, extensions };
}

function shallowEquals(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  if (a === b) {
    return true;
  }
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) {
    return false;
  }
  return aKeys.every((key) => a[key] === b[key]);
}
