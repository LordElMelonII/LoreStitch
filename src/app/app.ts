import { Component, effect, inject, signal } from '@angular/core';
import { BreakpointObserver } from '@angular/cdk/layout';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { MatSidenavModule } from '@angular/material/sidenav';
import { WorkspaceService } from './core/services/workspace.service';
import { MOBILE_BREAKPOINT_QUERY } from './shared/constants/breakpoints';
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
  host: { '[class.mobile]': 'isMobile()' },
})
export class App {
  protected readonly workspace = inject(WorkspaceService);
  private readonly breakpoints = inject(BreakpointObserver);

  protected readonly isMobile = toSignal(
    this.breakpoints.observe(MOBILE_BREAKPOINT_QUERY).pipe(map((r) => r.matches)),
    { initialValue: false },
  );

  protected readonly leftOpened = signal(true);
  protected readonly rightOpened = signal(true);

  constructor() {
    effect(() => {
      if (this.isMobile()) {
        this.leftOpened.set(false);
        this.rightOpened.set(false);
      } else {
        this.leftOpened.set(true);
        this.rightOpened.set(true);
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
