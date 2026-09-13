import { Service, inject } from '@angular/core';
import { MatChipInputEvent, MatChipSelectionChange } from '@angular/material/chips';
import { MatSlideToggleChange } from '@angular/material/slide-toggle';
import {
  CharacterBookEntry,
  WI_POSITION_TO_ST,
  WiPosition,
  WiTriggerState,
  triggerStatePatch,
} from '../../core/models/lorebook.model';
import { WorkspaceService } from '../../core/services/workspace.service';

/** The two entry fields that hold key lists. */
type KeyListField = 'keys' | 'secondary_keys';

/**
 * Field-level mutations shared by the entry field editor sections
 * (`EntryMetadata`, `EntryControlStrip`, `EntryKeys`, `EntryContentField`,
 * `EntryAdvancedPanel`). Every helper patches the entry through the
 * WorkspaceService, so the section components carry only UI state and all
 * workspace writes funnel through here. Entries without an id (transient)
 * are never patched.
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
