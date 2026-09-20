import {
  Component,
  DOCUMENT,
  ElementRef,
  Signal,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
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
  BarState,
} from './features/shell/mobile-bottom-bar/mobile-bottom-bar';
import { LayoutService } from './shared/services/layout.service';
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
  private readonly actions = inject(ProjectActionsService);

  /** Children the shell forwards actions into (search dialog, batch pane). */
  private readonly topbar = viewChild(Topbar);
  private readonly entryList = viewChild(EntryList);

  /**
   * Shell geometry the drawer focus/scroll reclaim works on: the pannable
   * sidenav container and the two drawer panes. Read as ElementRef — only
   * the host elements matter here, not the component instances.
   */
  private readonly workspaceEl: Signal<ElementRef<HTMLElement> | undefined> = viewChild(
    'workspaceEl',
    { read: ElementRef },
  );
  private readonly entriesPaneEl: Signal<ElementRef<HTMLElement> | undefined> = viewChild(
    'entriesPane',
    { read: ElementRef },
  );
  private readonly historyPaneEl: Signal<ElementRef<HTMLElement> | undefined> = viewChild(
    'historyPane',
    { read: ElementRef },
  );

  private readonly document = inject(DOCUMENT);

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

  /**
   * The bottom bar's state: `backgrounded` while either drawer overlays the
   * editor (the docked bar veils and inerts itself), `normal` otherwise.
   * Full-viewport CDK overlays need no member here — they cover the strip
   * themselves. Task 06 P2 will extend this with the `batch` case once the
   * entries drawer owns a selection; do not pre-wire selection here.
   */
  protected readonly barState = computed<BarState>(() =>
    this.anyDrawerOpen() ? 'backgrounded' : 'normal',
  );

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
      // A window-class flip re-lays-out the shell; a stale sideways pan on
      // the workspace must not survive it (see settleAfterDrawerClose for
      // how a pan can exist at all). The pan caused by a collapse fired
      // here is re-zeroed again when the drawer's `(closed)` event lands.
      this.resetWorkspaceScroll();
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
    this.settleAfterDrawerClose(this.entriesPaneEl());
  }

  protected closeRight(): void {
    this.rightOpened.set(false);
    this.settleAfterDrawerClose(this.historyPaneEl());
  }

  /**
   * Reclaims the shell after a drawer closes, whichever way it was
   * triggered — backdrop tap, Escape and viewport-flip collapses all end at
   * the sidenav's `(closed)` event.
   *
   * Mechanic being corrected: on close, Material restores focus to whatever
   * held it before the drawer opened — which can be a control inside the
   * now off-canvas pane. The browser then focus-scrolls the nearest
   * scrollable ancestor to reveal that element: the `overflow: hidden`
   * `.workspace` container, which gets panned sideways (observed scrollLeft
   * 105–276px at phone widths) and, being hidden overflow, can never be
   * panned back by the user. So: drop focus when it landed back inside the
   * doomed pane (Material's own fallback for an unknown restore target is
   * the same `blur()`; a settled closed drawer is `visibility: hidden`, so
   * sequential focus navigation skips it and cannot re-pan), then re-zero
   * the pan the restore already caused.
   */
  private settleAfterDrawerClose(pane: ElementRef<HTMLElement> | undefined): void {
    const active = this.document.activeElement;
    const paneEl = pane?.nativeElement;
    if (paneEl && active instanceof HTMLElement && paneEl.contains(active)) {
      active.blur();
    }
    this.resetWorkspaceScroll();
  }

  /** The workspace is overflow:hidden — a sideways pan there is unrecoverable. */
  private resetWorkspaceScroll(): void {
    const workspace = this.workspaceEl()?.nativeElement;
    if (workspace) {
      workspace.scrollLeft = 0;
      workspace.scrollTop = 0;
    }
  }

  /**
   * Phone pane-focus policy, bound to both drawers' `(opened)` events:
   * when an over-mode drawer finishes opening on a phone, the shell
   * focuses its pane element (Material stamps tabindex="-1" on it).
   *
   * Why this is a correctness requirement, not polish: the docked bar goes
   * inert while a drawer is open, and inerting content that holds focus
   * releases focus to `<body>` — the very tap that opens the drawer hits
   * this. From `<body>` the pane's Escape handling (a keydown listener on
   * the pane element) never sees a key, and screen readers never announce
   * the drawer. Focusing the pane makes Escape-to-close work from every
   * open path (bar item, topbar hamburger, keyboard) and announces the
   * pane for AT.
   *
   * Guarded to phones so tablet/desktop behavior is untouched: persistent
   * triggers keep their focus (the desktop persistent-trigger pin), and
   * `side`-mode drawers have no backdrop semantics to mirror.
   *
   * Implemented here, not in the bar: the bar is presentational by charter
   * (render, emit) and holds no pane reference — the shell owns the
   * drawers, so it owns their focus policy.
   */
  private focusPaneOnPhone(pane: ElementRef<HTMLElement> | undefined): void {
    if (this.layout.isMobile()) {
      pane?.nativeElement.focus();
    }
  }

  protected onEntriesDrawerOpened(): void {
    this.focusPaneOnPhone(this.entriesPaneEl());
  }

  protected onHistoryDrawerOpened(): void {
    this.focusPaneOnPhone(this.historyPaneEl());
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
        // The bar item stays docked under the drawer it opens (backgrounded
        // + inert); the phone focus handoff for the pane lives in
        // `onHistoryDrawerOpened`, once the drawer has actually opened.
        this.toggleRight();
        break;
    }
  }
}
