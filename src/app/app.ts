import { Component, computed, effect, inject, signal, viewChild } from '@angular/core';
import { MatSidenavModule } from '@angular/material/sidenav';
import { WorkspaceService } from './core/services/workspace.service';
import { EntryList } from './features/entry-list/entry-list';
import { EntryEditor } from './features/entry-editor/entry-editor';
import { CommitHistory } from './features/commit-history/commit-history';
import { Topbar } from './features/shell/topbar/topbar';
import { WelcomeScreen } from './features/shell/welcome-screen/welcome-screen';
import {
  MobileBottomBar,
  MobileBarAction,
} from './features/shell/mobile-bottom-bar/mobile-bottom-bar';
import { LayoutService } from './shared/services/layout.service';
import { ResponsiveOverlayService } from './shared/services/responsive-overlay.service';
import { ProjectActionsService } from './features/shell/project-actions.service';

/** Studio shell: top bar, entry sidenav, tabbed editor, commit history drawer. */
@Component({
  selector: 'app-root',
  imports: [
    MatSidenavModule,
    Topbar,
    WelcomeScreen,
    EntryList,
    EntryEditor,
    CommitHistory,
    MobileBottomBar,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  host: {
    '[class.mobile]': 'viewport() === "mobile"',
    '[class.focus-mode]': 'layout.focusMode() && viewport() === "desktop"',
  },
})
export class App {
  protected readonly workspace = inject(WorkspaceService);
  protected readonly layout = inject(LayoutService);
  private readonly overlays = inject(ResponsiveOverlayService);
  private readonly actions = inject(ProjectActionsService);

  /** Children the shell forwards actions into (search dialog, batch pane). */
  private readonly topbar = viewChild(Topbar);
  private readonly entryList = viewChild(EntryList);

  /**
   * The active responsive window class (mobile < 768px, tablet
   * 768px–1279px, desktop >= 1280px) — owned by `LayoutService`, the single
   * source of viewport truth; aliased here for the template and effects.
   */
  protected readonly viewport = this.layout.viewport;

  protected readonly leftOpened = signal(true);
  protected readonly rightOpened = signal(true);

  /** Whether either sidenav drawer overlays the editor right now. */
  protected readonly anyDrawerOpen = computed(() => this.leftOpened() || this.rightOpened());

  /** Whether any dialog or bottom sheet covers the app right now. */
  protected readonly anyOverlayOpen = this.overlays.anyOverlayOpen;

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

    // Focus mode is a desktop-only affordance: shrinking the window below
    // the desktop class ends it instead of leaving a cramped editor.
    effect(() => {
      if (this.viewport() !== 'desktop' && this.layout.focusMode()) {
        this.layout.focusMode.set(false);
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

  /**
   * Routes a mobile bottom-bar quick action to the component or service that
   * owns it — the bar itself stays presentational and only emits (its Export
   * item additionally opens the shared export menu in place, never routed).
   */
  protected runBarAction(action: MobileBarAction): void {
    switch (action) {
      case 'new-entry':
        this.actions.createEntry();
        break;
      case 'search-replace':
        // Single source of truth: the topbar opener owns the dialog config
        // (width, compact class, active-entry seeding).
        void this.topbar()?.openSearch();
        break;
      case 'batch':
        // The sidebar owns the live selection the batch pane edits.
        void this.entryList()?.openBatchOperations();
        break;
      case 'history':
        this.toggleRight();
        break;
    }
  }
}
