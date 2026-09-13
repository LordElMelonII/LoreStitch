import { Component, computed, inject, input } from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  CharacterBookEntry,
  entryTriggerState,
  ST_ROLE,
  WI_POSITION_OPTIONS,
  WiTriggerState,
} from '../../../core/models/lorebook.model';
import { EntryUpdatesService } from '../entry-updates.service';
import { MatChipsModule } from '@angular/material/chips';

/**
 * Placement section of the entry options panel: where the entry lands in the
 * prompt (position, depth, role, outlet) and its ordering (order, priority).
 * A section of `EntryOptionsAccordion`.
 */
@Component({
  selector: 'app-entry-placement',
  imports: [MatChipsModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatTooltipModule],
  templateUrl: './entry-placement.html',
  styleUrl: './entry-placement.scss',
  host: { class: 'entry-panel-section' },
})
export class EntryPlacement {
  protected readonly updates = inject(EntryUpdatesService);

  /** The entry being edited (owned by the enclosing `EntryOptionsAccordion`). */
  readonly entry = input.required<CharacterBookEntry>();

  protected readonly positionOptions = WI_POSITION_OPTIONS;

  protected readonly roleOptions = [
    { value: ST_ROLE.system, label: 'System', icon: '⚙️' },
    { value: ST_ROLE.user, label: 'User', icon: '👤' },
    { value: ST_ROLE.assistant, label: 'Assistant', icon: '🤖' },
  ];

  /** Depth & role only make sense when the entry is inserted at a chat depth. */
  protected readonly isAtDepth = computed(() => this.entry().position === 'at_depth');

  /** Outlet entries are pulled into the prompt manually via the outlet macro. */
  protected readonly isOutlet = computed(() => this.entry().position === 'outlet');

  /** True while the entry always triggers — key-based modifiers don't apply. */
  protected readonly isConstant = computed(() => this.triggerState() === 'constant');

  /** The entry's trigger strategy: normal 🟢 / constant 🔵 / vectorized 🔗. */
  protected readonly triggerState = computed<WiTriggerState>(() => entryTriggerState(this.entry()));
}
