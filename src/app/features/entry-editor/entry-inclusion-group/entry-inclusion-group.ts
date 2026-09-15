import { Component, inject, input } from '@angular/core';
import { FormField, form, max, min } from '@angular/forms/signals';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CharacterBookEntry, EntryExtensionKey } from '../../../core/models/lorebook.model';
import { entrySliceSignal, extNumberOrNull, extText } from '../entry-edit-form';
import { EntryUpdatesService } from '../entry-updates.service';

/** Form model of the inclusion group section (native-input fields only). */
interface EntryInclusionGroupModel {
  /** Comma-separated group labels, exactly as SillyTavern stores them. */
  group: string;
  groupWeight: number | null;
}

/**
 * Inclusion group section of the entry options panel: how the entry competes
 * with simultaneously-triggered siblings — SillyTavern's Inclusion Group and
 * Group Weight decide the winner by a weighted roll, Prioritize Inclusion
 * replaces the roll with the highest Order, and Use Group Scoring narrows the
 * group to the entries with the most key matches first. The group / weight
 * inputs are a Signal Form over the workspace entry (see `entrySliceSignal`);
 * the chip and the tri-state select stay Material-driven.
 * A section of `EntryOptionsAccordion`.
 */
@Component({
  selector: 'app-entry-inclusion-group',
  imports: [
    FormField,
    MatChipsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatTooltipModule,
  ],
  templateUrl: './entry-inclusion-group.html',
  styleUrl: './entry-inclusion-group.scss',
  host: { class: 'entry-panel-section' },
})
export class EntryInclusionGroup {
  protected readonly updates = inject(EntryUpdatesService);

  /** The entry being edited (owned by the enclosing `EntryOptionsAccordion`). */
  readonly entry = input.required<CharacterBookEntry>();

  private readonly model = entrySliceSignal<EntryInclusionGroupModel>({
    source: this.entry,
    fallback: { group: '', groupWeight: 100 },
    pick: (entry) => ({
      group: extText(entry.extensions['group']),
      groupWeight: extNumberOrNull(entry.extensions['group_weight']),
    }),
    toPatch: (entry, model) => ({
      extensions: {
        ...entry.extensions,
        group: model.group,
        group_weight: model.groupWeight ?? 100,
      },
    }),
  });

  protected readonly groupForm = form(this.model, (s) => {
    min(s.groupWeight, 1, { message: 'Group weight cannot be below 1' });
    max(s.groupWeight, 10000, { message: 'Group weight cannot be above 10000' });
  });

  /** Boolean / nullable extension values read straight from extensions. */
  protected ext(key: EntryExtensionKey): unknown {
    return this.entry().extensions[key];
  }

  /**
   * The tri-state group-scoring override as the select reads it: SillyTavern
   * may also persist a numeric score, which behaves as a truthy "enabled".
   */
  protected groupScoring(): boolean | null {
    const value = this.entry().extensions['use_group_scoring'];
    if (value === null || value === undefined) {
      return null;
    }
    return typeof value === 'number' ? value !== 0 : !!value;
  }
}
