import { Component, effect, inject, signal } from '@angular/core';
import { BreakpointObserver } from '@angular/cdk/layout';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { MatSidenavModule } from '@angular/material/sidenav';
import { WorkspaceService } from './core/services/workspace.service';
import {
  DESKTOP_BREAKPOINT_QUERY,
  MOBILE_BREAKPOINT_QUERY,
  TABLET_BREAKPOINT_QUERY,
  ViewportClass,
} from './shared/constants/breakpoints';
import { EntryList } from './features/entry-list/entry-list';
import { EntryEditor } from './features/entry-editor/entry-editor';
import { CommitHistory } from './features/commit-history/commit-history';
import { Topbar } from './features/shell/topbar/topbar';
import { WelcomeScreen } from './features/shell/welcome-screen/welcome-screen';

/** Studio shell: top bar, entry sidenav, tabbed editor, commit history drawer. */
@Component({
  selector: 'app-root',
  imports: [MatSidenavModule, Topbar, WelcomeScreen, EntryList, EntryEditor, CommitHistory],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  host: { '[class.mobile]': 'viewport() === "mobile"' },
})
export class App {
  protected readonly workspace = inject(WorkspaceService);
  private readonly breakpoints = inject(BreakpointObserver);

  /**
   * The active responsive window class: mobile (< 768px), tablet
   * (768px–1279px) or desktop (>= 1280px). Defaults to desktop when no query
   * matches (e.g. test environments without matchMedia).
   */
  protected readonly viewport = toSignal(
    this.breakpoints
      .observe([MOBILE_BREAKPOINT_QUERY, TABLET_BREAKPOINT_QUERY, DESKTOP_BREAKPOINT_QUERY])
      .pipe(
        map(({ breakpoints }): ViewportClass =>
          breakpoints[MOBILE_BREAKPOINT_QUERY]
            ? 'mobile'
            : breakpoints[TABLET_BREAKPOINT_QUERY]
              ? 'tablet'
              : 'desktop',
        ),
      ),
    { initialValue: 'desktop' },
  );

  protected readonly leftOpened = signal(true);
  protected readonly rightOpened = signal(true);

  constructor() {
    // Re-apply the per-class defaults when the window class changes. User
    // toggles stay sticky until the layout class itself flips.
    effect(() => {
      switch (this.viewport()) {
        case 'mobile':
          this.leftOpened.set(false);
          this.rightOpened.set(false);
          break;
        case 'tablet':
          this.leftOpened.set(true);
          this.rightOpened.set(false);
          break;
        case 'desktop':
          this.leftOpened.set(true);
          this.rightOpened.set(true);
          break;
      }
    });
  }

  protected toggleLeft(): void {
    this.leftOpened.update((v) => !v);
  }

  protected toggleRight(): void {
    this.rightOpened.update((v) => !v);
  }

  protected closeLeft(): void {
    this.leftOpened.set(false);
  }

  protected closeRight(): void {
    this.rightOpened.set(false);
  }
}
