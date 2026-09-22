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
  BatchBarAction,
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
   * The bottom bar's state (Task 06 §3.2): `batch` while the entries drawer
   * is open with an active selection (the transplanted toolbar, foreground);
   * otherwise `backgrounded` while either drawer overlays the editor (the
   * docked bar veils and inerts itself); `normal` otherwise. Full-viewport
   * CDK overlays (dialogs, sheets, menus) need no member here — they cover
   * the strip themselves, so `batch` deliberately stays `batch` under an
   * open dialog.
   */
  protected readonly barState = computed<BarState>(() => {
    if (this.leftOpened() && !this.rightOpened() && this.barSelectionCount() > 0) {
      return 'batch';
    }
    return this.anyDrawerOpen() ? 'backgrounded' : 'normal';
  });

  /**
   * Selection facts the shell mirrors off the `EntryList` public API (Task
   * 06 §3.3) and forwards to the bar's batch strip: the count and the
   * select-all checkbox's tri-state sides. `?? defaults` mask the window
   * before the deferred entries list resolves.
   */
  protected readonly barSelectionCount = computed(() => this.entryList()?.selectionCount() ?? 0);
  protected readonly barAllShownSelected = computed(
    () => this.entryList()?.allFilteredSelected() ?? false,
  );
  protected readonly barSomeShownSelected = computed(
    () => this.entryList()?.someFilteredSelected() ?? false,
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
   * Also reused by the batch swap's focus recovery
   * (`refocusEntriesPaneAfterSelectionCollapse`): a bar action that
   * collapses the selection unmounts the tapped control and lowers the bar
   * to `backgrounded` — the same focus-to-`<body>` accident, same cure.
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
      default: {
        // Union-level exhaustiveness (see runBatchBarAction): a new
        // `MobileBarAction` member added without a case must not route
        // silently to nothing.
        const unhandled: never = action;
        throw new Error(`Unhandled bar action: ${String(unhandled)}`);
      }
    }
  }

  /**
   * Routes a mobile bottom-bar BATCH action (the selection swap, Task 06
   * §3.2) to the `EntryList` public method that owns it — the bar's
   * transplanted toolbar and menu stay presentational and only emit.
   *
   * `more-batch-actions` is a deliberate no-op: the bar's more_vert trigger
   * opens its own batch menu in place (like the Export item), so nothing is
   * ever routed through the shell for it — the member exists to keep the
   * plan's union shape.
   *
   * `select-all-shown` arrives as a bare member from both the checkbox and
   * the menu leaf; the bar carries no boolean, so the shell resolves the
   * intent against the same public tri-state fact it feeds the bar with
   * (`EntryList.allFilteredSelected`, read synchronously inside this
   * handler — still the pre-tap state): everything shown already selected
   * means the tap deselects the shown entries, otherwise it selects them
   * all — exactly the drawer checkbox's behavior, with the leaf (disabled
   * when all-selected) reducing to the same rule.
   *
   * Focus recovery: `clear-selection` and `delete-selection` can collapse
   * `selectionCount()` to 0 mid-tap, flipping `batch` → `backgrounded` and
   * unmounting the tapped control — focus falls to `<body>` under the
   * now-inert strip (the same class of accident §3.4's pane-focus policy
   * fixes). The shell re-focuses the entries pane after both, mirroring
   * `focusPaneOnPhone` (entries pane only, phone only); for delete it waits
   * for the async confirm dialog to resolve and only recovers when the
   * selection actually cleared — a cancelled confirm keeps the swap alive
   * with its trigger intact and focus stays with the bar.
   */
  protected async runBatchBarAction(action: BatchBarAction): Promise<void> {
    const list = this.entryList();
    if (!list) {
      return;
    }
    switch (action) {
      case 'batch-edit':
        void list.openBatchOperations();
        break;
      case 'export-selected':
        list.exportSelection();
        break;
      case 'more-batch-actions':
        // Never emitted by the bar (its menu opens in place); kept so the
        // switch stays exhaustive over the plan's union.
        break;
      case 'duplicate-selection':
        list.duplicateSelection();
        break;
      case 'enable-selection':
        list.setSelectionEnabled(true);
        break;
      case 'disable-selection':
        list.setSelectionEnabled(false);
        break;
      case 'select-all-shown':
        list.selectAllShown(!list.allFilteredSelected());
        break;
      case 'delete-selection': {
        await list.deleteSelection();
        // Recover focus only when the selection ACTUALLY collapsed — the
        // case a cancelled confirm dialog leaves behind is a still-active
        // swap (`selectionCount() > 0`) whose tapped control never
        // unmounted: Material restores focus onto it, so the shell must not
        // steal it into the pane (bar interaction must keep working). The
        // unmount → `<body>` focus drop the recovery cures only exists on
        // the confirmed path, where the count became 0.
        if (list.selectionCount() === 0) {
          this.refocusEntriesPaneAfterSelectionCollapse();
        }
        break;
      }
      case 'clear-selection':
        list.clearSelection();
        this.refocusEntriesPaneAfterSelectionCollapse();
        break;
      default: {
        // Union-level exhaustiveness: with every member cased above, `action`
        // narrows to `never` here — so a new `BatchBarAction` member added
        // without a case is a COMPILE error, never a silent fallthrough to
        // nothing (the routing test in app.spec.ts walks all nine members).
        const unhandled: never = action;
        throw new Error(`Unhandled batch bar action: ${String(unhandled)}`);
      }
    }
  }

  /**
   * The batch-swap focus recovery: mirror of `focusPaneOnPhone` for the
   * entries pane — phone only, entries pane only, re-run after a bar action
   * that unmounts the control the user just tapped.
   */
  private refocusEntriesPaneAfterSelectionCollapse(): void {
    this.focusPaneOnPhone(this.entriesPaneEl());
  }
}
