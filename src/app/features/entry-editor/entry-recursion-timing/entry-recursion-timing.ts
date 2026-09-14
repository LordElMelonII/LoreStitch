import { Component, computed, inject, input } from '@angular/core';
import { FormField, form, min } from '@angular/forms/signals';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CharacterBookEntry, EntryExtensionKey } from '../../../core/models/lorebook.model';
import { EntryUpdatesService } from '../entry-updates.service';
import { entrySliceSignal, extNumberOrNull } from '../entry-edit-form';

/** Form model of the recursion & timing section (numeric inputs only). */
interface EntryRecursionTimingModel {
  /** Recursion pass; null means "level 1" (stored as `true`). */
  recursionLevel: number | null;
  sticky: number | null;
  cooldown: number | null;
  delay: number | null;
}

/**
 * Recursion & timing section of the entry options panel: the recursion guards
 * (non-recursable, prevent further recursion, delay until recursion with its
 * level) and the timed effects (sticky, cooldown, delay), all measured the
 * way world-info.js applies them. The numeric inputs are a Signal Form over
 * the workspace entry (see `entrySliceSignal`); the guards are chips.
 * A section of `EntryOptionsAccordion`.
 */
@Component({
  selector: 'app-entry-recursion-timing',
  imports: [FormField, MatChipsModule, MatFormFieldModule, MatInputModule, MatTooltipModule],
  templateUrl: './entry-recursion-timing.html',
  styleUrl: './entry-recursion-timing.scss',
  host: { class: 'entry-panel-section' },
})
export class EntryRecursionTiming {
  protected readonly updates = inject(EntryUpdatesService);

  /** The entry being edited (owned by the enclosing `EntryOptionsAccordion`). */
  readonly entry = input.required<CharacterBookEntry>();

  private readonly model = entrySliceSignal<EntryRecursionTimingModel>({
    source: this.entry,
    fallback: { recursionLevel: null, sticky: null, cooldown: null, delay: null },
    pick: (entry) => ({
      recursionLevel: extNumberOrNull(entry.extensions['delay_until_recursion']),
      sticky: extNumberOrNull(entry.extensions['sticky']),
      cooldown: extNumberOrNull(entry.extensions['cooldown']),
      delay: extNumberOrNull(entry.extensions['delay']),
    }),
    toPatch: (entry, model) => ({
      extensions: {
        ...entry.extensions,
        // Level 1 (or a cleared field) stays the plain `true` of world-info.js.
        delay_until_recursion:
          model.recursionLevel === null || model.recursionLevel <= 1 ? true : model.recursionLevel,
        sticky: model.sticky,
        cooldown: model.cooldown,
        delay: model.delay,
      },
    }),
  });

  protected readonly timingForm = form(this.model, (s) => {
    min(s.recursionLevel, 1, { message: 'Recursion level starts at 1' });
    min(s.sticky, 0, { message: 'Sticky cannot be negative' });
    min(s.cooldown, 0, { message: 'Cooldown cannot be negative' });
    min(s.delay, 0, { message: 'Delay cannot be negative' });
  });

  /** `extensions.delay_until_recursion`: `false` / `true` (level 1) / level number. */
  protected readonly delayUntilRecursion = computed(
    () => this.entry().extensions['delay_until_recursion'] ?? false,
  );

  /** Boolean / nullable extension values read straight from extensions. */
  protected ext(key: EntryExtensionKey): unknown {
    return this.entry().extensions[key];
  }
}
