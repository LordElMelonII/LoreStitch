import { BreakpointObserver } from '@angular/cdk/layout';
import { Component, computed, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormField, form } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule, MatLabel } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { map } from 'rxjs';
import {
  CharacterBookEntry,
  WiTriggerState,
  entryTriggerState,
} from '../../../core/models/lorebook.model';
import { MOBILE_BREAKPOINT_QUERY } from '../../../shared/constants/breakpoints';
import { entrySliceSignal } from '../entry-edit-form';
import { EntryActivation } from '../entry-activation/entry-activation';
import { EntryKeys } from '../entry-keys/entry-keys';
import { EntryMatchingSources } from '../entry-matching-sources/entry-matching-sources';
import { EntryPlacement } from '../entry-placement/entry-placement';
import { EntryRecursionTiming } from '../entry-recursion-timing/entry-recursion-timing';
import { EntryUpdatesService } from '../entry-updates.service';

/** Form model of the always-visible trigger strip's order field. */
interface TriggerStripModel {
  order: number;
}

/**
 * Bottom accordion of the entry editor: the basic controls (Enabled, trigger
 * strategy, case sensitivity) stay visible as the trigger row while every
 * other option collapses into an expandable panel, keeping the writing phase
 * uncluttered. The panel is anchored above the strip on desktop and grows
 * upward over the content; on mobile it opens downward in the scroll flow.
 * The panel content is composed of the section components (`EntryPlacement`,
 * `EntryActivation`, `EntryKeys`, `EntryRecursionTiming`,
 * `EntryMatchingSources`); this component owns only the trigger row, the
 * expand state and the panel chrome. A section of `EntryEditor`.
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

  /** Whether the full option panel is expanded above/below the trigger row. */
  protected readonly expanded = signal(false);

  // Mirrors the shell's mobile breakpoint (`App`), which drives the expansion
  // direction: the panel opens downward in flow on mobile, upward on desktop.
  private readonly breakpoints = inject(BreakpointObserver);
  protected readonly isMobile = toSignal(
    this.breakpoints.observe(MOBILE_BREAKPOINT_QUERY).pipe(map((r) => r.matches)),
    { initialValue: false },
  );

  /** The entry's trigger strategy: normal 🟢 / constant 🔵 / vectorized 🔗. */
  protected readonly triggerState = computed<WiTriggerState>(() => entryTriggerState(this.entry()));

  /** Chevron pointing where the panel will move: down to open on mobile (in
   * flow), up to open on desktop (anchored above the strip); inverted closed. */
  protected readonly toggleIcon = computed(() => {
    if (this.isMobile()) {
      return this.expanded() ? 'expand_less' : 'expand_more';
    }
    return this.expanded() ? 'expand_more' : 'expand_less';
  });

  /** Stable id for the panel / `aria-controls` pair (one accordion per tab). */
  protected readonly panelId = computed(() => `entry-options-panel-${this.entry().id}`);

  protected toggle(): void {
    this.expanded.update((open) => !open);
  }
}
