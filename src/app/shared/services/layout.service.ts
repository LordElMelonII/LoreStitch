import { Service, signal } from '@angular/core';

/**
 * Studio-wide layout preferences. Focus mode constrains the editor column to
 * a reading-friendly width; it is a desktop-only affordance, so the shell
 * clears the flag whenever the viewport leaves the desktop class.
 */
@Service()
export class LayoutService {
  /** Whether the editor area is narrowed for easier reading. */
  readonly focusMode = signal(false);

  toggleFocusMode(): void {
    this.focusMode.update((on) => !on);
  }
}
