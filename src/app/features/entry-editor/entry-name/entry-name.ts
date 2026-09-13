import { Component, inject, input } from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import {
  CharacterBookEntry
} from '../../../core/models/lorebook.model';
import { EntryUpdatesService } from '../entry-updates.service';

/**
 * Identity & placement cluster of the entry editor: name, insertion position
 * (with the @ Depth and Outlet extras) and ordering. A section of
 * `EntryFields`; mutations go through `EntryUpdatesService`.
 */
@Component({
  selector: 'app-entry-name',
  imports: [MatFormFieldModule, MatInputModule],
  templateUrl: './entry-name.html',
  styleUrl: './entry-name.scss',
})
export class EntryName {
  protected readonly updates = inject(EntryUpdatesService);

  /** The entry being edited (owned by the enclosing `EntryFields`). */
  readonly entry = input.required<CharacterBookEntry>();
}
