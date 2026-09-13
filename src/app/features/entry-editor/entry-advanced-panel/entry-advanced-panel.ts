import { Component, inject, input } from '@angular/core';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CharacterBookEntry, ST_LOGIC } from '../../../core/models/lorebook.model';
import { EntryUpdatesService } from '../entry-updates.service';

/**
 * "SillyTavern Advanced" accordion of the entry editor: the extensions
 * carried in exports (probability, secondary logic, recursion guards). A
 * section of `EntryFields`.
 */
@Component({
  selector: 'app-entry-advanced-panel',
  imports: [
    MatExpansionModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatTooltipModule,
  ],
  templateUrl: './entry-advanced-panel.html',
  styleUrl: './entry-advanced-panel.scss',
})
export class EntryAdvancedPanel {
  protected readonly updates = inject(EntryUpdatesService);

  /** The entry being edited (owned by the enclosing `EntryFields`). */
  readonly entry = input.required<CharacterBookEntry>();

  protected readonly logicOptions = [
    { value: ST_LOGIC.AND_ANY, label: 'AND Any' },
    { value: ST_LOGIC.NOT_ALL, label: 'NOT All' },
    { value: ST_LOGIC.NOT_ANY, label: 'NOT Any' },
    { value: ST_LOGIC.AND_ALL, label: 'AND All' },
  ];
}
