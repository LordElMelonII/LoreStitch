import { Component, computed, inject, input } from '@angular/core';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CharacterBookEntry } from '../../../core/models/lorebook.model';
import { EntryUpdatesService } from '../entry-updates.service';

/**
 * Recursion & timing section of the entry options panel: the recursion guards
 * (non-recursable, prevent further recursion, delay until recursion with its
 * level) and the timed effects (sticky, cooldown, delay), all measured the
 * way world-info.js applies them. A section of `EntryOptionsAccordion`.
 */
@Component({
  selector: 'app-entry-recursion-timing',
  imports: [MatChipsModule, MatFormFieldModule, MatInputModule, MatTooltipModule],
  templateUrl: './entry-recursion-timing.html',
  styleUrl: './entry-recursion-timing.scss',
  host: { class: 'entry-panel-section' },
})
export class EntryRecursionTiming {
  protected readonly updates = inject(EntryUpdatesService);

  /** The entry being edited (owned by the enclosing `EntryOptionsAccordion`). */
  readonly entry = input.required<CharacterBookEntry>();

  /** `extensions.delay_until_recursion`: `false` / `true` (level 1) / level number. */
  protected readonly delayUntilRecursion = computed(
    () => this.entry().extensions['delay_until_recursion'] ?? false,
  );

  /** Set recursion level; `null` when the delay is a plain boolean. */
  protected readonly delayRecursionLevel = computed(() => {
    const value = this.delayUntilRecursion();
    return typeof value === 'number' ? value : null;
  });

  /** Boolean / nullable extension values read straight from extensions. */
  protected ext(key: string): unknown {
    return this.entry().extensions[key];
  }
}
