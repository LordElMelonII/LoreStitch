import { Component, computed, inject, input } from '@angular/core';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  CharacterBookEntry,
  WiTriggerState,
  entryTriggerState,
} from '../../../core/models/lorebook.model';
import { EntryUpdatesService } from '../entry-updates.service';

/**
 * Segmented button toggle group for the entry's activation strategy (Normal 🟢,
 * Constant 🔵, Vector 🔗).
 *
 * Renders inline in the desktop accordion trigger strip and in the mobile
 * options sheet panel. Dispatches changes to `EntryUpdatesService.setTriggerState`.
 */
@Component({
  selector: 'app-entry-strategy-toggle',
  imports: [MatButtonToggleModule, MatTooltipModule],
  templateUrl: './entry-strategy-toggle.html',
  styleUrl: './entry-strategy-toggle.scss',
})
export class EntryStrategyToggle {
  protected readonly updates = inject(EntryUpdatesService);

  /** The entry being edited. */
  readonly entry = input.required<CharacterBookEntry>();

  /** The entry's trigger strategy: normal 🟢 / constant 🔵 / vectorized 🔗. */
  protected readonly triggerState = computed<WiTriggerState>(() => entryTriggerState(this.entry()));
}
