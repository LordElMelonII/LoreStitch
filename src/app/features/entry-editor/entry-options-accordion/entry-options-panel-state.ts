import { Injectable, signal } from '@angular/core';

/**
 * Shared expansion state of the advanced options panel (the expandable bar
 * under the editor). Every editor tab hosts its own `EntryOptionsAccordion`
 * instance, but the open/closed choice is a studio-wide preference: once the
 * user expands the bar it stays expanded when they open another entry or
 * switch tabs, instead of each tab starting collapsed again.
 */
@Injectable({ providedIn: 'root' })
export class EntryOptionsPanelState {
  /** Whether the full option panel is expanded above/below the trigger row. */
  readonly expanded = signal(false);
}
