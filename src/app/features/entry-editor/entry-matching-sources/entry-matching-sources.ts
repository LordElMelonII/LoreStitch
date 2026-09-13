import { Component, inject, input } from '@angular/core';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CharacterBookEntry } from '../../../core/models/lorebook.model';
import { EntryUpdatesService } from '../entry-updates.service';

/** Per-entry "additional matching sources" chips, ordered like the ST docs. */
const MATCH_SOURCE_OPTIONS = [
  {
    key: 'match_character_description',
    label: 'Character Description',
    hint: 'Also match keys against the character description',
  },
  {
    key: 'match_character_personality',
    label: 'Character Personality',
    hint: 'Also match keys against the character personality summary',
  },
  {
    key: 'match_scenario',
    label: 'Scenario',
    hint: 'Also match keys against the character scenario',
  },
  {
    key: 'match_persona_description',
    label: 'Persona Description',
    hint: 'Also match keys against the active persona description',
  },
  {
    key: 'match_character_depth_prompt',
    label: "Character's Note",
    hint: 'Also match keys against the character note',
  },
  {
    key: 'match_creator_notes',
    label: "Creator's Notes",
    hint: 'Also match keys against the character creator notes',
  },
] as const;

/**
 * Matching sources section of the entry options panel: the "additional
 * matching sources" checkboxes (match keys against character / persona text
 * that never reaches the chat) and the per-entry whole-words override.
 * A section of `EntryOptionsAccordion`.
 */
@Component({
  selector: 'app-entry-matching-sources',
  imports: [MatChipsModule, MatFormFieldModule, MatSelectModule, MatTooltipModule],
  templateUrl: './entry-matching-sources.html',
  styleUrl: './entry-matching-sources.scss',
  host: { class: 'entry-panel-section' },
})
export class EntryMatchingSources {
  protected readonly updates = inject(EntryUpdatesService);

  /** The entry being edited (owned by the enclosing `EntryOptionsAccordion`). */
  readonly entry = input.required<CharacterBookEntry>();

  protected readonly matchSourceOptions = MATCH_SOURCE_OPTIONS;

  /** Boolean / nullable extension values read straight from extensions. */
  protected ext(key: string): unknown {
    return this.entry().extensions[key];
  }
}
