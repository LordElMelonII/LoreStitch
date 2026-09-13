import { Component, computed, inject, input } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  CharacterBookEntry,
  ST_ROLE,
  WI_POSITION_OPTIONS,
} from '../../../core/models/lorebook.model';
import { EntryUpdatesService } from '../entry-updates.service';

/**
 * Identity & placement cluster of the entry editor: name, insertion position
 * (with the @ Depth and Outlet extras) and ordering. A section of
 * `EntryFields`; mutations go through `EntryUpdatesService`.
 */
@Component({
  selector: 'app-entry-metadata',
  imports: [MatCardModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatTooltipModule],
  templateUrl: './entry-metadata.html',
  styleUrl: './entry-metadata.scss',
})
export class EntryMetadata {
  protected readonly updates = inject(EntryUpdatesService);

  /** The entry being edited (owned by the enclosing `EntryFields`). */
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
}
