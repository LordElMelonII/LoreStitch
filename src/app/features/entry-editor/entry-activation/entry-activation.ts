import { Component, computed, inject, input } from '@angular/core';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  CharacterBookEntry,
  ST_TRIGGER_OPTIONS,
  WiTriggerState,
  entryCharacterFilter,
  entryTriggerState,
  entryTriggers,
} from '../../../core/models/lorebook.model';
import { EntryUpdatesService } from '../entry-updates.service';

/**
 * Activation section of the entry options panel: everything that filters
 * *whether* the entry fires — scan depth override, trigger probability,
 * generation types, the character filter and the Quick Replies automation id.
 * A section of `EntryOptionsAccordion`.
 */
@Component({
  selector: 'app-entry-activation',
  imports: [MatChipsModule, MatFormFieldModule, MatInputModule, MatTooltipModule],
  templateUrl: './entry-activation.html',
  styleUrl: './entry-activation.scss',
  host: { class: 'entry-panel-section' },
})
export class EntryActivation {
  protected readonly updates = inject(EntryUpdatesService);

  /** The entry being edited (owned by the enclosing `EntryOptionsAccordion`). */
  readonly entry = input.required<CharacterBookEntry>();

  /** Generation types this entry may activate for (the ST `triggers` filter). */
  protected readonly triggerOptions = ST_TRIGGER_OPTIONS;

  /** Currently allowed generation types; empty = all. */
  protected readonly triggers = computed(() => entryTriggers(this.entry()));

  /** The entry's character activation filter (names + exclude mode). */
  protected readonly characterFilter = computed(() => entryCharacterFilter(this.entry()));

  /** Label for the character filter row, flipped by the exclude chip. */
  protected readonly characterFilterHint = computed(() =>
    this.characterFilter().is_exclude
      ? 'Activates for every character except these names'
      : 'Activates only for these character names',
  );

  /** Tri-state / nullable extension values read straight from extensions. */
  protected ext(key: string): unknown {
    return this.entry().extensions[key];
  }

  /** True while the entry always triggers — key-based modifiers don't apply. */
  protected readonly isConstant = computed(() => this.triggerState() === 'constant');

  /** The entry's trigger strategy: normal 🟢 / constant 🔵 / vectorized 🔗. */
  protected readonly triggerState = computed<WiTriggerState>(() => entryTriggerState(this.entry()));
}
