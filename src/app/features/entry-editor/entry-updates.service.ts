import { Service, inject } from '@angular/core';
import { MatChipInputEvent, MatChipSelectionChange } from '@angular/material/chips';
import { MatSlideToggleChange } from '@angular/material/slide-toggle';
import {
  CharacterBookEntry,
  NormalizedCharacterFilter,
  ST_TRIGGERS,
  StTrigger,
  WI_POSITION_TO_ST,
  WiPosition,
  WiTriggerState,
  entryCharacterFilter,
  entryTriggers,
  triggerStatePatch,
} from '../../core/models/lorebook.model';
import { WorkspaceService } from '../../core/services/workspace.service';

/** The two entry fields that hold key lists. */
type KeyListField = 'keys' | 'secondary_keys';

/**
 * Field-level mutations shared by the entry field editor sections
 * (`EntryName`, `EntryContentField`, `EntryKeys` and the panel sections of
 * `EntryOptionsAccordion`).
 * Every helper patches the entry through the WorkspaceService, so the section
 * components carry only UI state and all workspace writes funnel through
 * here. Entries without an id (transient) are never patched.
 */
@Service()
export class EntryUpdatesService {
  private readonly workspace = inject(WorkspaceService);

  /** Text edits: name / comment / content. */
  setText(entry: CharacterBookEntry, field: 'comment' | 'name' | 'content', event: Event): void {
    const value = (event.target as HTMLTextAreaElement | HTMLInputElement).value;
    this.patch(entry, { [field]: value });
  }

  /** Numeric edits: insertion order and priority (an empty priority clears it). */
  setNumber(entry: CharacterBookEntry, field: 'insertion_order' | 'priority', event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    if (field === 'priority' && raw === '') {
      this.patch(entry, { priority: undefined });
      return;
    }
    const value = Number(raw);
    if (!Number.isNaN(value)) {
      this.patch(entry, { [field]: value });
    }
  }

  /**
   * Changes the insertion position. The ST-native numeric mirror in
   * `extensions.position` is kept in sync so exports round-trip.
   */
  setPosition(entry: CharacterBookEntry, value: WiPosition): void {
    this.patch(entry, {
      position: value,
      extensions: { ...entry.extensions, position: WI_POSITION_TO_ST[value] },
    });
  }

  setExtension(entry: CharacterBookEntry, key: string, value: unknown): void {
    this.patch(entry, { extensions: { ...entry.extensions, [key]: value } });
  }

  setExtensionText(entry: CharacterBookEntry, key: string, event: Event): void {
    this.setExtension(entry, key, (event.target as HTMLInputElement).value);
  }

  /** Numeric extension edits; an empty input falls back to `fallback`. */
  setExtensionNumber(
    entry: CharacterBookEntry,
    key: string,
    event: Event,
    fallback: number | null,
  ): void {
    const raw = (event.target as HTMLInputElement).value;
    if (raw === '') {
      this.setExtension(entry, key, fallback);
      return;
    }
    const value = Number(raw);
    if (!Number.isNaN(value)) {
      this.setExtension(entry, key, value);
    }
  }

  setExtensionFlag(entry: CharacterBookEntry, key: string, change: MatSlideToggleChange): void {
    this.setExtension(entry, key, change.checked);
  }

  /** Master flags driven by slide toggles. */
  setFlag(
    entry: CharacterBookEntry,
    field: 'enabled' | 'selective' | 'case_sensitive',
    change: MatSlideToggleChange,
  ): void {
    this.patch(entry, { [field]: change.checked });
  }

  /** Filter-chip counterpart of `setFlag` for the execution modifiers. */
  setChipFlag(
    entry: CharacterBookEntry,
    field: 'selective' | 'case_sensitive',
    change: MatChipSelectionChange,
  ): void {
    if (!change.isUserInput) {
      return;
    }
    this.patch(entry, { [field]: change.selected });
  }

  /** Filter-chip counterpart of `setExtension` for boolean extension flags. */
  setExtensionChipFlag(
    entry: CharacterBookEntry,
    key: string,
    change: MatChipSelectionChange,
  ): void {
    if (!change.isUserInput) {
      return;
    }
    this.setExtension(entry, key, change.selected);
  }

  /** Toggles a generation type inside the entry's trigger filter. */
  toggleTrigger(
    entry: CharacterBookEntry,
    trigger: StTrigger,
    change: MatChipSelectionChange,
  ): void {
    if (!change.isUserInput) {
      return;
    }
    const selected = new Set(entryTriggers(entry));
    if (change.selected) {
      selected.add(trigger);
    } else {
      selected.delete(trigger);
    }
    this.setExtension(
      entry,
      'triggers',
      ST_TRIGGERS.filter((value) => selected.has(value)),
    );
  }

  /**
   * Toggles "delay until recursion": on, it stays `true` (first recursion
   * level) unless a deeper level was already set — mirroring world-info.js.
   */
  setDelayUntilRecursion(entry: CharacterBookEntry, change: MatChipSelectionChange): void {
    if (!change.isUserInput) {
      return;
    }
    const current = entry.extensions['delay_until_recursion'];
    const value =
      change.selected && typeof current === 'number' && current > 1 ? current : change.selected;
    this.setExtension(entry, 'delay_until_recursion', value);
  }

  /** Recursion level input: empty = level 1 (stored as `true`), like ST. */
  setDelayUntilRecursionLevel(entry: CharacterBookEntry, event: Event): void {
    const raw = ((event.target as HTMLInputElement).value ?? '').trim();
    if (raw === '') {
      this.setExtension(entry, 'delay_until_recursion', true);
      return;
    }
    const value = Number(raw);
    if (Number.isNaN(value)) {
      this.setExtension(entry, 'delay_until_recursion', false);
      return;
    }
    this.setExtension(entry, 'delay_until_recursion', value === 1 ? true : value);
  }

  /** The entry's character activation filter (lazily defaulted for editing). */
  characterFilter(entry: CharacterBookEntry): NormalizedCharacterFilter {
    return entryCharacterFilter(entry);
  }

  /** Exclude mode inverts the character filter (activate for everyone else). */
  toggleCharacterFilterExclude(entry: CharacterBookEntry, change: MatChipSelectionChange): void {
    if (!change.isUserInput) {
      return;
    }
    this.setExtension(entry, 'character_filter', {
      ...entryCharacterFilter(entry),
      is_exclude: change.selected,
    });
  }

  /** Splits the comma-separated character name list into the filter. */
  setCharacterFilterNames(entry: CharacterBookEntry, event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    const names = [
      ...new Set(
        raw
          .split(',')
          .map((name) => name.trim())
          .filter(Boolean),
      ),
    ];
    this.setExtension(entry, 'character_filter', { ...entryCharacterFilter(entry), names });
  }

  /** Switches the trigger strategy (normal 🟢 / constant 🔵 / vectorized 🔗). */
  setTriggerState(entry: CharacterBookEntry, state: WiTriggerState): void {
    this.patch(entry, triggerStatePatch(entry, state));
  }

  /** Replaces a whole key list (in-place edits funnel here). */
  setKeys(entry: CharacterBookEntry, field: KeyListField, keys: string[]): void {
    this.patch(entry, { [field]: keys } as Partial<CharacterBookEntry>);
  }

  /** Adds a chip-input token as a key, keeping the list free of duplicates. */
  addKey(entry: CharacterBookEntry, field: KeyListField, event: MatChipInputEvent): void {
    const value = event.value.trim();
    if (entry.id === undefined || !value) {
      return;
    }
    const list = [...(entry[field] ?? [])];
    if (!list.includes(value)) {
      list.push(value);
      this.setKeys(entry, field, list);
    }
    // Clear the chip input.
    event.input.value = '';
  }

  removeKey(entry: CharacterBookEntry, field: KeyListField, index: number): void {
    const list = [...(entry[field] ?? [])];
    list.splice(index, 1);
    this.setKeys(entry, field, list);
  }

  /** Patches the entry in the working tree; transient entries are ignored. */
  private patch(entry: CharacterBookEntry, patch: Partial<CharacterBookEntry>): void {
    if (entry.id !== undefined) {
      this.workspace.updateEntry(entry.id, patch);
    }
  }
}
