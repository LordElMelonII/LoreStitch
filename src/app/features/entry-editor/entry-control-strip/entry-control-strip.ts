import { Component, computed, inject, input } from '@angular/core';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  CharacterBookEntry,
  ST_ROLE,
  WI_POSITION_OPTIONS,
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
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatTooltipModule,
  ],
  templateUrl: './entry-control-strip.html',
  styleUrl: './entry-control-strip.scss',
})
export class EntryControlStrip {
  protected readonly positionOptions = WI_POSITION_OPTIONS;

  protected readonly updates = inject(EntryUpdatesService);

  /** The entry being edited (owned by the enclosing `EntryFields`). */
  readonly entry = input.required<CharacterBookEntry>();

  /** The entry's trigger strategy: normal 🟢 / constant 🔵 / vectorized 🔗. */
  protected readonly triggerState = computed<WiTriggerState>(() => entryTriggerState(this.entry()));

  /** True while the entry always triggers — key-based modifiers don't apply. */
  protected readonly isConstant = computed(() => this.triggerState() === 'constant');

  protected readonly roleOptions = [
    { value: ST_ROLE.system, label: 'System', icon: '⚙️' },
    { value: ST_ROLE.user, label: 'User', icon: '👤' },
    { value: ST_ROLE.assistant, label: 'Assistant', icon: '🤖' },
  ];

  /** Depth & role only make sense when the entry is inserted at a chat depth. */
  protected readonly isAtDepth = computed(() => this.entry().position === 'at_depth');

  /** Outlet entries are pulled into the prompt manually via the outlet macro. */
  protected readonly isOutlet = computed(() => this.entry().position === 'outlet');
}
