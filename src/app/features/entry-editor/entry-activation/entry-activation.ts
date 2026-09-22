import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { FormField, form, max, min } from '@angular/forms/signals';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  CharacterBookEntry,
  EntryExtensionKey,
  ST_TRIGGER_OPTIONS,
  WiTriggerState,
  entryCharacterFilter,
  entryTriggerState,
  entryTriggers,
  parseNameList,
} from '../../../core/models/lorebook.model';
import { EntryUpdatesService } from '../entry-updates.service';
import { entrySliceSignal, extNumber, extNumberOrNull, extText } from '../entry-edit-form';

/** Form model of the activation section (native-input fields only). */
interface EntryActivationModel {
  scanDepth: number | null;
  probability: number | null;
  automationId: string;
  /** Comma-separated character names as typed. */
  filterNames: string;
}

/**
 * Activation section of the entry options panel: everything that filters
 * *whether* the entry fires — scan depth override, trigger probability,
 * generation types, the character filter and the Quick Replies automation id.
 * The numeric / text inputs are a Signal Form over the workspace entry (see
 * `entrySliceSignal`); the chip selectors stay Material-driven.
 * A section of `EntryOptionsAccordion`.
 */
@Component({
  selector: 'app-entry-activation',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormField, MatChipsModule, MatFormFieldModule, MatInputModule, MatTooltipModule],
  templateUrl: './entry-activation.html',
  styleUrl: './entry-activation.scss',
  host: { class: 'entry-panel-section' },
})
export class EntryActivation {
  protected readonly updates = inject(EntryUpdatesService);

  /** The entry being edited (owned by the enclosing `EntryOptionsAccordion`). */
  readonly entry = input.required<CharacterBookEntry>();

  private readonly model = entrySliceSignal<EntryActivationModel>({
    source: this.entry,
    fallback: { scanDepth: null, probability: 100, automationId: '', filterNames: '' },
    pick: (entry) => ({
      scanDepth: extNumberOrNull(entry.extensions['scan_depth']),
      probability: extNumberOrNull(entry.extensions['probability']),
      automationId: extText(entry.extensions['automation_id']),
      filterNames: entryCharacterFilter(entry).names.join(', '),
    }),
    toPatch: (entry, model) => ({
      extensions: {
        ...entry.extensions,
        scan_depth: model.scanDepth,
        probability: extNumber(model.probability, 100),
        automation_id: model.automationId,
        character_filter: {
          ...entryCharacterFilter(entry),
          names: parseNameList(model.filterNames),
        },
      },
    }),
  });

  protected readonly activationForm = form(this.model, (s) => {
    min(s.scanDepth, 0, { message: 'Scan depth cannot be negative' });
    min(s.probability, 0, { message: 'Probability cannot be below 0%' });
    max(s.probability, 100, { message: 'Probability cannot be above 100%' });
  });

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
  protected ext(key: EntryExtensionKey): unknown {
    return this.entry().extensions[key];
  }

  /** True while the entry always triggers — key-based modifiers don't apply. */
  protected readonly isConstant = computed(() => this.triggerState() === 'constant');

  /** The entry's trigger strategy: normal 🟢 / constant 🔵 / vectorized 🔗. */
  protected readonly triggerState = computed<WiTriggerState>(() => entryTriggerState(this.entry()));
}
