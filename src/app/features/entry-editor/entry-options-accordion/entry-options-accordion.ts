import { BreakpointObserver } from '@angular/cdk/layout';
import { Component, computed, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  CharacterBookEntry,
  WiTriggerState,
  entryTriggerState,
} from '../../../core/models/lorebook.model';
import { EntryActivation } from '../entry-activation/entry-activation';
import { EntryKeys } from '../entry-keys/entry-keys';
import { EntryMatchingSources } from '../entry-matching-sources/entry-matching-sources';
import { EntryPlacement } from '../entry-placement/entry-placement';
import { EntryRecursionTiming } from '../entry-recursion-timing/entry-recursion-timing';
import { EntryUpdatesService } from '../entry-updates.service';

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
    MatButtonModule,
    MatButtonToggleModule,
    MatCardModule,
    MatChipsModule,
    MatIconModule,
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

  /** Whether the full option panel is expanded above/below the trigger row. */
  protected readonly expanded = signal(false);

  // Mirrors the shell's mobile breakpoint (`App`), which drives the expansion
  // direction: the panel opens downward in flow on mobile, upward on desktop.
  private readonly breakpoints = inject(BreakpointObserver);
  protected readonly isMobile = toSignal(
    this.breakpoints.observe('(max-width: 767px)').pipe(map((r) => r.matches)),
    { initialValue: false },
  );

  /** The entry's trigger strategy: normal 🟢 / constant 🔵 / vectorized 🔗. */
  protected readonly triggerState = computed<WiTriggerState>(() => entryTriggerState(this.entry()));

  /** True while the entry always triggers — key-based modifiers don't apply. */
  protected readonly isConstant = computed(() => this.triggerState() === 'constant');

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
