import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { FormField, form } from '@angular/forms/signals';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { CharacterBookEntry } from '../../../core/models/lorebook.model';
import { entrySliceSignal } from '../entry-edit-form';

/** Form model of the identity section. */
interface EntryNameModel {
  comment: string;
}

/**
 * Identity section of the entry editor: the name / comment line. A section of
 * `EntryFields`; the field is a Signal Form over the workspace entry (see
 * `entrySliceSignal`).
 */
@Component({
  selector: 'app-entry-name',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormField, MatFormFieldModule, MatInputModule],
  templateUrl: './entry-name.html',
  styleUrl: './entry-name.scss',
})
export class EntryName {
  /** The entry being edited (owned by the enclosing `EntryFields`). */
  readonly entry = input.required<CharacterBookEntry>();

  private readonly model = entrySliceSignal<EntryNameModel>({
    source: this.entry,
    fallback: { comment: '' },
    pick: (entry) => ({ comment: entry.comment ?? '' }),
    toPatch: (_entry, model) => ({ comment: model.comment }),
  });

  protected readonly nameForm = form(this.model);
}
