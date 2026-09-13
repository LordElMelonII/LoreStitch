import { Component, computed, inject, input } from '@angular/core';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  CharacterBookEntry,
  WiTriggerState,
  entryTriggerState,
} from '../../../core/models/lorebook.model';
import { EntryUpdatesService } from '../entry-updates.service';

/**
 * Control strip of the entry editor: the master Enabled switch, the trigger
 * strategy selector (normal 🟢 / constant 🔵 / vectorized 🔗) and the
 * execution modifier chips. A section of `EntryFields`.
 */
@Component({
  selector: 'app-entry-control-strip',
  imports: [
    MatButtonToggleModule,
    MatCardModule,
    MatChipsModule,
    MatSlideToggleModule,
    MatTooltipModule,
  ],
  templateUrl: './entry-control-strip.html',
  styleUrl: './entry-control-strip.scss',
})
export class EntryControlStrip {
  protected readonly updates = inject(EntryUpdatesService);

  /** The entry being edited (owned by the enclosing `EntryFields`). */
  readonly entry = input.required<CharacterBookEntry>();

  /** The entry's trigger strategy: normal 🟢 / constant 🔵 / vectorized 🔗. */
  protected readonly triggerState = computed<WiTriggerState>(() => entryTriggerState(this.entry()));

  /** True while the entry always triggers — key-based modifiers don't apply. */
  protected readonly isConstant = computed(() => this.triggerState() === 'constant');
}
