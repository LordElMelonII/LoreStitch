import { Component, computed, inject, input } from '@angular/core';
import { FormField, form } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule, MatLabel } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  CharacterBookEntry,
  WiTriggerState,
  entryTriggerState,
} from '../../../core/models/lorebook.model';
import { LayoutService } from '../../../shared/services/layout.service';
import { entrySliceSignal } from '../entry-edit-form';
import { EntryActivation } from '../entry-activation/entry-activation';
import { EntryInclusionGroup } from '../entry-inclusion-group/entry-inclusion-group';
import { EntryKeys } from '../entry-keys/entry-keys';
import { EntryMatchingSources } from '../entry-matching-sources/entry-matching-sources';
import { EntryPlacement } from '../entry-placement/entry-placement';
import { EntryRecursionTiming } from '../entry-recursion-timing/entry-recursion-timing';
import { EntryUpdatesService } from '../entry-updates.service';
import { EntryOptionsPanelState } from './entry-options-panel-state';

/** Form model of the always-visible trigger strip's order field. */
interface TriggerStripModel {
  order: number;
}

/**
 * Bottom accordion of the entry editor: the basic controls (Enabled, trigger
 * strategy, case sensitivity) stay visible as the trigger row while every
 * other option collapses into an expandable panel, keeping the writing phase
 * uncluttered. The panel always opens upward above the strip — as an anchored
 * overlay on desktop and as a sheet above the strip, which sticks to the
 * bottom edge of the scrollport, on mobile. The panel content is composed of
 * the section components (`EntryPlacement`, `EntryActivation`, `EntryKeys`,
 * `EntryRecursionTiming`, `EntryMatchingSources`); this component owns only
 * the trigger row and the panel chrome, while the expand state is shared
 * studio-wide through `EntryOptionsPanelState`. A section of `EntryEditor`.
 */
@Component({
  selector: 'app-entry-options-accordion',
  imports: [
    FormField,
    MatButtonModule,
    MatButtonToggleModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatLabel,
    MatSlideToggleModule,
    MatTooltipModule,
    EntryActivation,
    EntryInclusionGroup,
    EntryKeys,
    EntryMatchingSources,
    EntryPlacement,
    EntryRecursionTiming,
  ],
  templateUrl: './entry-options-accordion.html',
  styleUrl: './entry-options-accordion.scss',
  host: { '[class.expanded]': 'expanded()', '[class.mobile]': 'isMobile()' },
})
export class EntryOptionsAccordion {
  protected readonly updates = inject(EntryUpdatesService);

  /** The entry being edited (owned by the enclosing `EntryEditor`). */
  readonly entry = input.required<CharacterBookEntry>();

  private readonly stripModel = entrySliceSignal<TriggerStripModel>({
    source: this.entry,
    fallback: { order: 100 },
    pick: (entry) => ({ order: entry.insertion_order ?? 100 }),
    toPatch: (_entry, model) => ({ insertion_order: model.order ?? 100 }),
  });

  protected readonly stripForm = form(this.stripModel);

  /**
   * Whether the full option panel is expanded. The signal lives in the shared
   * `EntryOptionsPanelState`, so the choice sticks across editor tabs: a new
   * or re-opened tab inherits the expanded bar instead of collapsing it.
   */
  protected readonly expanded = inject(EntryOptionsPanelState).expanded;

  // Mirrors the shell's mobile breakpoint through `LayoutService` (the single
  // source of viewport truth), which drives the expansion direction: the
  // panel opens downward in flow on mobile, upward on desktop.
  protected readonly isMobile = inject(LayoutService).isMobile;

  /** The entry's trigger strategy: normal 🟢 / constant 🔵 / vectorized 🔗. */
  protected readonly triggerState = computed<WiTriggerState>(() => entryTriggerState(this.entry()));

  /** Chevron pointing where the panel will move: closed shows an up chevron
   * (the panel opens upward, anchored above the strip), open shows a down
   * chevron (collapse downward). Both layout classes expand upward now — on
   * desktop as an overlay, on mobile as a sheet above the sticky strip. */
  protected readonly toggleIcon = computed(() => (this.expanded() ? 'expand_more' : 'expand_less'));

  /** Stable id for the panel / `aria-controls` pair (one accordion per tab). */
  protected readonly panelId = computed(() => `entry-options-panel-${this.entry().id}`);

  protected toggle(): void {
    this.expanded.update((open) => !open);
  }
}
