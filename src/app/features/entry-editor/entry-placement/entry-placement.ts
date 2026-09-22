import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { FormField, form, min } from '@angular/forms/signals';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  CharacterBookEntry,
  ST_ROLE_OPTIONS,
  WI_POSITION_OPTIONS,
} from '../../../core/models/lorebook.model';
import { EntryUpdatesService } from '../entry-updates.service';
import { entrySliceSignal, extNumber, extText } from '../entry-edit-form';

/** Form model of the placement section (native-input fields only). */
interface EntryPlacementModel {
  depth: number | null;
  outletName: string;
  priority: number | null;
}

/**
 * Placement section of the entry options panel: where the entry lands in the
 * prompt (position, depth, role, outlet) and its ordering (order, priority).
 * The depth / outlet / priority inputs are a Signal Form over the workspace
 * entry (see `entrySliceSignal`); position and role stay Material selects.
 * A section of `EntryOptionsAccordion`.
 */
@Component({
  selector: 'app-entry-placement',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormField, MatFormFieldModule, MatInputModule, MatSelectModule, MatTooltipModule],
  templateUrl: './entry-placement.html',
  styleUrl: './entry-placement.scss',
  host: { class: 'entry-panel-section' },
})
export class EntryPlacement {
  protected readonly updates = inject(EntryUpdatesService);

  /** The entry being edited (owned by the enclosing `EntryOptionsAccordion`). */
  readonly entry = input.required<CharacterBookEntry>();

  private readonly model = entrySliceSignal<EntryPlacementModel>({
    source: this.entry,
    fallback: { depth: 4, outletName: '', priority: null },
    pick: (entry) => ({
      depth: extNumber(entry.extensions['depth'], 4),
      outletName: extText(entry.extensions['outlet_name']),
      priority: entry.priority ?? null,
    }),
    toPatch: (entry, model) => ({
      priority: model.priority ?? undefined,
      extensions: {
        ...entry.extensions,
        depth: extNumber(model.depth, 4),
        outlet_name: model.outletName,
      },
    }),
  });

  protected readonly placementForm = form(this.model, (s) => {
    min(s.depth, 0, { message: 'Depth cannot be negative' });
  });

  protected readonly positionOptions = WI_POSITION_OPTIONS;

  protected readonly roleOptions = ST_ROLE_OPTIONS;

  /** Depth & role only make sense when the entry is inserted at a chat depth. */
  protected readonly isAtDepth = computed(() => this.entry().position === 'at_depth');

  /** Outlet entries are pulled into the prompt manually via the outlet macro. */
  protected readonly isOutlet = computed(() => this.entry().position === 'outlet');
}
