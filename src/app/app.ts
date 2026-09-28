import {
  Component,
  DestroyRef,
  DOCUMENT,
  ElementRef,
  Signal,
  afterRenderEffect,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { MatSidenavContainer, MatSidenavModule } from '@angular/material/sidenav';
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

/**
 * Entries drawer resize clamp (task 21 D3, user-locked): the user decides,
 * the app clamps. 320px is the batch-bar capacity floor the drawer is
 * designed around; 480px keeps the editor column readable. No per-band
 * scaling — the same range applies on tablet and desktop.
 */
const ENTRIES_WIDTH_MIN = 320;
const ENTRIES_WIDTH_MAX = 480;
const ENTRIES_WIDTH_DEFAULT = ENTRIES_WIDTH_MIN;
/** Keyboard resize step per ArrowLeft/ArrowRight press. */
const ENTRIES_KEYBOARD_STEP_PX = 8;
/** localStorage key for the drawer width — a shell UI preference, never project state. */
const ENTRIES_WIDTH_STORAGE_KEY = 'lorestitch.entries-drawer-width';
/**
 * Body class while a pointer drag resizes the drawer (added on pointerdown,
 * removed on drag end/cancel/destroy): gives the whole page a col-resize
 * cursor and suppresses text selection under the dragged pointer. Styled in
 * styles.scss — `<body>` belongs to no component.
 */
const ENTRIES_RESIZE_ACTIVE_CLASS = 'entries-resize-active';

/** Clamps a raw width into the D3 range, rounded to whole pixels; non-finite garbage falls back to the default. */
function clampEntriesWidth(value: number): number {
  if (!Number.isFinite(value)) {
    return ENTRIES_WIDTH_DEFAULT;
  }
  return Math.min(ENTRIES_WIDTH_MAX, Math.max(ENTRIES_WIDTH_MIN, Math.round(value)));
}

/**
 * Startup read of the persisted width, already clamped. Guarded because
 * storage access can throw (private modes, disabled storage) — the same
 * contract ThemeService's restore follows.
 */
function restoreEntriesWidth(): number {
  try {
    const stored = localStorage.getItem(ENTRIES_WIDTH_STORAGE_KEY);
    if (stored !== null) {
      return clampEntriesWidth(Number(stored));
    }
  } catch {
    // Storage unavailable — fall through to the default.
  }
  return ENTRIES_WIDTH_DEFAULT;
}

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

  /**
   * The same container element as `workspaceEl`, read as the
   * `MatSidenavContainer` component instance: live drawer resizes must
   * recompute the content margins Material host-binds onto the editor pane
   * (see the resize effect in the constructor).
   */
  private readonly workspaceContainer: Signal<MatSidenavContainer | undefined> = viewChild(
    'workspaceEl',
    { read: MatSidenavContainer },
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
  private readonly destroyRef = inject(DestroyRef);

  /**
   * The active responsive window class (mobile < 768px, tablet
   * 768px–1279px, desktop >= 1280px) — owned by `LayoutService`, the single
   * source of viewport truth; aliased here for the template and effects.
   */
  protected readonly viewport = this.layout.viewport;

  protected readonly leftOpened = signal(true);
  protected readonly rightOpened = signal(true);

  /**
   * Docked entries-drawer width in px (task 21 D3, user-locked): the user
   * decides, the app clamps to 320–480 (see the module-head constants). A
   * shell UI preference — it never routes through `WorkspaceService` or
   * project state; it persists straight to localStorage and is read +
   * clamped at startup. The template applies it to `.entries-sidenav` via
   * an inline `[style.width.px]` binding whenever the viewport is not
   * mobile — on the mobile band the binding yields `null` so the D2 CSS
   * full-width contract wins instead.
   */
  protected readonly entriesWidth = signal<number>(restoreEntriesWidth());

  /** D3 clamp bounds, mirrored for the resize handle's aria-valuemin/max contract. */
  protected readonly entriesWidthMin = ENTRIES_WIDTH_MIN;
  protected readonly entriesWidthMax = ENTRIES_WIDTH_MAX;

  /**
   * Live pointer-drag state, null while idle: the captured pointer id and
   * the handle it was captured on. `setPointerCapture` retargets every later
   * pointermove/up/cancel to the handle, so the template bindings on the
   * handle see the whole gesture even when the pointer leaves its bounds.
   */
  private drag: { pointerId: number; handle: HTMLElement } | null = null;

  /**
   * True from the first handled resize keydown until keyup: the keyboard
   * path updates the width live per key press but persists once, on keyup.
   */
  private keyboardResizeActive = false;

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
    // A mid-drag teardown must not leak the body-level drag chrome or a
    // stale drag state — the pointer capture itself dies with the element.
    this.destroyRef.onDestroy(() => this.endResizeDrag());

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

    // A viewport-band flip mid-drag tears the gesture's ground out from
    // under it: the mobile band unmounts the handle entirely (implicitly
    // releasing the pointer capture, so pointerup never reaches the
    // handler) and any band change re-lays-out the drawer's geometry. End
    // the drag there — no commit, the same contract as pointercancel — so
    // `entries-resize-active` can never linger on <body> and a stale drag
    // state can never swallow (or mis-serve) later gestures.
    effect(() => {
      this.viewport();
      this.endResizeDrag();
    });

    // A live inline width change on the docked drawer is invisible to
    // Material: the container recomputes the editor pane's `margin-left`
    // (host-bound to its `_contentMargins`) only via its public
    // `updateContentMargins()`, which fires on drawer open/close animations,
    // mode changes and window resizes — never on a style binding. Without
    // this, a resize leaves the editor keeping the stale margin: the drawer
    // overlaps the content until it is closed and reopened (user-reported,
    // close/reopen is exactly Material's `_animationStarted` recompute).
    //
    // This must be `afterRenderEffect`, not a plain `effect`: the hook runs
    // in the after-render phase of the same change-detection pass that
    // applied the `[style.width.px]` binding, so the forced-layout
    // `offsetWidth` read inside `updateContentMargins` (`MatSidenav
    // ._getWidth`) sees the width JUST applied. A plain effect re-ran before
    // the binding write in the same flush, so a single-jump change (keyboard
    // End/Home, dblclick reset) computed the margin from the PREVIOUS width —
    // and the change check in `updateContentMargins` then locked the stale
    // margin in, because nothing re-fires it. Measured on the dev server
    // before this switch: End left the editor at the 320px margin under a
    // 480px drawer (full overlap), Home left a 160px dead gap, and a drag
    // settled one move-step behind. The in-repo precedent for post-render
    // hooks is the entry-keys in-place editor (`entry-keys.ts`).
    //
    // During a pointer drag this fires per move — the method is cheap (read
    // width, compare, emit) and Material's own `.mat-drawer-transition` gives
    // the margin a smooth follow. The viewport read is untracked on purpose:
    // band flips already recompute margins through Material's own resize
    // handling, and keeping this effect strictly width-driven makes "no
    // width change, no recompute" hold. The mobile band binds null and runs
    // the drawer in over mode (no content margins to maintain), so it skips
    // entirely.
    afterRenderEffect(() => {
      this.entriesWidth();
      if (untracked(this.viewport) === 'mobile') {
        return;
      }
      this.workspaceContainer()?.updateContentMargins();
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

  // -------------------------------------------------------------------------
  // Entries drawer resize (task 21 D3, user-locked). The docked drawer's
  // width is a shell UI preference owned by `entriesWidth`: the handle's
  // pointer drag updates it live and commits on release, the keyboard steps
  // it live and commits on keyup, and a double-click resets it to the
  // 320px default. Every commit persists to localStorage (guarded — storage
  // can throw in private modes); pointercancel ends a drag WITHOUT
  // committing, and dropping the drag state keeps future gestures clean.
  // -------------------------------------------------------------------------

  protected onResizePointerDown(event: PointerEvent): void {
    // A second pointer (multi-touch) must not hijack an active drag.
    if (this.drag) {
      return;
    }
    const handle = event.currentTarget;
    if (!(handle instanceof HTMLElement)) {
      return;
    }
    this.drag = { pointerId: event.pointerId, handle };
    handle.setPointerCapture(event.pointerId);
    this.document.body.classList.add(ENTRIES_RESIZE_ACTIVE_CLASS);
  }

  protected onResizePointerMove(event: PointerEvent): void {
    if (this.drag?.pointerId !== event.pointerId) {
      return;
    }
    this.entriesWidth.set(this.entriesWidthAtPointer(event.clientX));
  }

  protected onResizePointerUp(event: PointerEvent): void {
    if (this.drag?.pointerId !== event.pointerId) {
      return;
    }
    this.endResizeDrag();
    this.persistEntriesWidth();
  }

  protected onResizePointerCancel(event: PointerEvent): void {
    if (this.drag?.pointerId !== event.pointerId) {
      return;
    }
    // A cancelled gesture keeps the live width but is not committed — the
    // drag state is dropped so the next gesture starts cleanly.
    this.endResizeDrag();
  }

  protected onResizeKeydown(event: KeyboardEvent): void {
    switch (event.key) {
      case 'ArrowLeft':
        this.entriesWidth.update((width) => clampEntriesWidth(width - ENTRIES_KEYBOARD_STEP_PX));
        break;
      case 'ArrowRight':
        this.entriesWidth.update((width) => clampEntriesWidth(width + ENTRIES_KEYBOARD_STEP_PX));
        break;
      case 'Home':
        this.entriesWidth.set(ENTRIES_WIDTH_MIN);
        break;
      case 'End':
        this.entriesWidth.set(ENTRIES_WIDTH_MAX);
        break;
      default:
        // Not a resize key — keep its native behavior.
        return;
    }
    this.keyboardResizeActive = true;
    // Handled keys must not scroll the page or move focus mid-resize.
    event.preventDefault();
  }

  protected onResizeKeyup(): void {
    if (!this.keyboardResizeActive) {
      return;
    }
    this.keyboardResizeActive = false;
    this.persistEntriesWidth();
  }

  /** Double-click reset: back to the designed 320px default, committed. */
  protected resetEntriesWidth(): void {
    this.entriesWidth.set(ENTRIES_WIDTH_DEFAULT);
    this.persistEntriesWidth();
  }

  /** Width under a dragged pointer: the pointer's distance from the drawer's left edge, clamped. */
  private entriesWidthAtPointer(clientX: number): number {
    const pane = this.entriesPaneEl()?.nativeElement;
    const left = pane?.getBoundingClientRect().left ?? 0;
    return clampEntriesWidth(clientX - left);
  }

  /**
   * Ends the active drag: drops the gesture state so future drags start
   * clean, releases the pointer capture (guarded — the browser may have
   * released it implicitly already and a stray release throws), and removes
   * the body-level drag chrome. Doubles as the DestroyRef cleanup path.
   */
  private endResizeDrag(): void {
    const drag = this.drag;
    if (!drag) {
      return;
    }
    this.drag = null;
    if (drag.handle.hasPointerCapture(drag.pointerId)) {
      drag.handle.releasePointerCapture(drag.pointerId);
    }
    this.document.body.classList.remove(ENTRIES_RESIZE_ACTIVE_CLASS);
  }

  private persistEntriesWidth(): void {
    try {
      localStorage.setItem(ENTRIES_WIDTH_STORAGE_KEY, String(this.entriesWidth()));
    } catch {
      // Storage unavailable (private mode etc.) — the width lasts the session.
    }
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
      case 'delimiters-selection':
        // Task 12 §5.2: the delimiter pane locked to the live selection.
        void list.openDelimiters();
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
        // nothing (the routing test in app.spec.ts walks all ten members).
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
