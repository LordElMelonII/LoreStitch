import { Component, inject, input } from '@angular/core';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CharacterBookEntry, EntryExtensionKey } from '../../../core/models/lorebook.model';
import { EntryUpdatesService } from '../entry-updates.service';
import { MATCH_SOURCE_OPTIONS } from './entry-matching-sources.constants';

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
  protected ext(key: EntryExtensionKey): unknown {
    return this.entry().extensions[key];
  }
}
