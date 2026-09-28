import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { DomSanitizer } from '@angular/platform-browser';
import { ANIMATION_MODULE_TYPE } from '@angular/core';
import { MatIconRegistry } from '@angular/material/icon';
import { MatSidenav } from '@angular/material/sidenav';
import { MatDialog } from '@angular/material/dialog';
import { ESCAPE } from '@angular/cdk/keycodes';
import { Subject } from 'rxjs';
import { App } from './app';
import { WorkspaceService } from './core/services/workspace.service';
import { LayoutService } from './shared/services/layout.service';
import { GITHUB_ICON } from './shared/constants/github';
import {
  DESKTOP_BREAKPOINT_QUERY,
  MOBILE_BREAKPOINT_QUERY,
  TABLET_BREAKPOINT_QUERY,
  ViewportClass,
} from './shared/constants/breakpoints';

/**
 * jsdom has no matchMedia. Install a stub whose active window class can be
 * flipped mid-test; the CDK observer reacts to change events exactly like a
 * real browser resizing.
 */
function installViewportStub(): { setViewport: (viewport: ViewportClass) => void } {
  let current: ViewportClass = 'desktop';
  const queryFor: Record<ViewportClass, string> = {
    mobile: MOBILE_BREAKPOINT_QUERY,
    tablet: TABLET_BREAKPOINT_QUERY,
    desktop: DESKTOP_BREAKPOINT_QUERY,
  };
  const registered: { query: string; listeners: Set<(event: { matches: boolean }) => void> }[] = [];
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => {
      const mql = {
        media: query,
        onchange: null,
        // A live getter: the CDK caches MediaQueryList objects and re-reads
        // their matches when a change event fires.
        get matches() {
          return query === queryFor[current];
        },
        addListener: (cb: (event: { matches: boolean }) => void) => entry.listeners.add(cb),
        removeListener: (cb: unknown) => entry.listeners.delete(cb as never),
        addEventListener: (_: string, cb: (event: { matches: boolean }) => void) =>
          entry.listeners.add(cb),
        removeEventListener: (_: string, cb: unknown) => entry.listeners.delete(cb as never),
        dispatchEvent: () => false,
      };
      const entry = { query, listeners: new Set<(event: { matches: boolean }) => void>() };
      registered.push(entry);
      return mql;
    },
  });
  return {
    setViewport(viewport: ViewportClass) {
      current = viewport;
      // Each MediaQueryList reports its own new state to its own listeners.
      for (const { query, listeners } of registered) {
        const matches = query === queryFor[current];
        for (const cb of [...listeners]) {
          cb({ matches });
        }
      }
    },
  };
}

/** The localStorage key App persists the entries drawer width under (task 21 D3). */
const ENTRIES_WIDTH_KEY = 'lorestitch.entries-drawer-width';

let nativeStorage: PropertyDescriptor | undefined;

/**
 * Swaps window.localStorage for a Map-backed stub: the drawer-width specs
 * must never touch real browser storage (values would leak across runs),
 * and the stub lets specs seed and inspect the exact stored bytes. The
 * original property descriptor is restored in afterEach.
 */
function installStorageStub(): Map<string, string> {
  // Capture the pristine descriptor once, before any stub is installed, so
  // afterEach can put the real jsdom storage back.
  nativeStorage ??= Object.getOwnPropertyDescriptor(window, 'localStorage');
  const store = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
    },
  });
  return store;
}

/** Replaces the storage stub with one whose every access throws (private mode). */
function installThrowingStorage(): void {
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: () => {
        throw new Error('storage denied');
      },
      setItem: () => {
        throw new Error('storage denied');
      },
    },
  });
}

/**
 * jsdom has no PointerEvent constructor, so the drag specs synthesize
 * pointer events from MouseEvents and shadow the pointerId — the same
 * idiom the Escape specs use for keyCode.
 */
function pointerEvent(type: string, clientX = 0, pointerId = 1): PointerEvent {
  const event = new MouseEvent(type, { clientX, bubbles: true });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  return event as unknown as PointerEvent;
}

/**
 * jsdom has no pointer-capture methods at all (calling one is a TypeError),
 * so the drag specs stub them on the handle element: `captured` tracks the
 * state App's guarded release path observes, across multiple gestures.
 */
function stubPointerCapture(handle: HTMLElement): { captured: boolean } {
  const state = { captured: false };
  handle.setPointerCapture = () => {
    state.captured = true;
  };
  handle.hasPointerCapture = () => state.captured;
  handle.releasePointerCapture = () => {
    state.captured = false;
  };
  return state;
}

describe('App', () => {
  let workspace: WorkspaceService;
  let layout: LayoutService;
  let viewport: { setViewport: (viewport: ViewportClass) => void };
  let storage: Map<string, string>;

  /**
   * Resizes the fake window: fires the CDK observer's change events, waits
   * out its debounceTime(0) macrotask, then settles the shell's effects.
   */
  async function resizeTo(viewportClass: ViewportClass): Promise<void> {
    viewport.setViewport(viewportClass);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();
  }

  let fixture: ComponentFixture<App>;

  async function createApp(): Promise<App> {
    fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    return fixture.componentInstance;
  }

  /** The D3 resize handle inside the docked entries drawer (desktop/tablet only). */
  function resizeHandle(): HTMLElement {
    const handle = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      '[aria-label="Resize entries panel"]',
    );
    assert(handle);
    return handle;
  }

  /** The drawer pane's live inline width, e.g. "328px" (empty when unbound). */
  function entriesPaneInlineWidth(): string {
    const pane = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      '.entries-sidenav',
    );
    assert(pane);
    return pane.style.width;
  }

  /** A KeyboardEvent with a spied preventDefault, for the handled-keys pins. */
  function spiedKeydown(key: string): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, cancelable: true });
    vi.spyOn(event, 'preventDefault');
    return event;
  }

  beforeEach(async () => {
    // The drawer-width specs must never touch real browser storage: every
    // test gets a fresh Map-backed stub, restored in afterEach.
    storage = installStorageStub();
    viewport = installViewportStub();
    await TestBed.configureTestingModule({
      imports: [App],
      // jsdom fires no transitionend, so a settled sidenav open would never
      // complete (Material only schedules the animation-end there when a
      // real transition is pending). NoopAnimations keeps the sidenav on its
      // simulated-animation path, where opened/closed events always emit —
      // the same public token a noop-animations app build provides.
      providers: [{ provide: ANIMATION_MODULE_TYPE, useValue: 'NoopAnimations' }],
    }).compileComponents();
    // The top bar renders the inlined GitHub mark. Its registration lives in
    // the app initializer (app.config), which unit tests bypass — replicate
    // it here so the icon registry does not log retrieval errors.
    TestBed.inject(MatIconRegistry).addSvgIconLiteral(
      'github',
      TestBed.inject(DomSanitizer).bypassSecurityTrustHtml(GITHUB_ICON),
    );
    workspace = TestBed.inject(WorkspaceService);
    layout = TestBed.inject(LayoutService);
    // Allow the workspace's async init() to settle before mounting the shell.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  afterEach(() => {
    // Put the real jsdom storage back so specs outside the drawer-width
    // block (and future ones) observe the platform, not a stale stub.
    if (nativeStorage) {
      Object.defineProperty(window, 'localStorage', nativeStorage);
    }
  });

  it('renders the welcome screen and no studio surfaces without a project', async () => {
    const app = await createApp();
    void app;
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('h1')?.textContent).toContain('LoreStitch');
    expect(compiled.querySelector('app-entry-list')).toBeNull();
    expect(compiled.querySelector('app-entry-editor')).toBeNull();
  });

  it('renders the studio surfaces once a project is open', async () => {
    await workspace.createProject('Fuyuki');
    await createApp();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('app-entry-list')).toBeTruthy();
    expect(compiled.querySelector('app-entry-editor')).toBeTruthy();
    // The history drawer defers on idle; give its scheduling a moment.
    await vi.waitFor(() => expect(compiled.querySelector('app-commit-history')).toBeTruthy(), {
      timeout: 5000,
    });
  });

  it('defaults both drawers open on desktop', async () => {
    const app = await createApp();

    expect(layout.viewport()).toBe('desktop');
    expect(app['leftOpened']()).toBe(true);
    expect(app['rightOpened']()).toBe(true);
    expect(fixture.nativeElement.classList.contains('mobile')).toBe(false);
  });

  it('collapses both drawers and flags the host on mobile', async () => {
    const app = await createApp();

    await resizeTo('mobile');

    expect(app['leftOpened']()).toBe(false);
    expect(app['rightOpened']()).toBe(false);
    expect(fixture.nativeElement.classList.contains('mobile')).toBe(true);
  });

  it('docks the entries drawer and overlays history on tablet', async () => {
    const app = await createApp();

    await resizeTo('tablet');

    expect(app['leftOpened']()).toBe(true);
    expect(app['rightOpened']()).toBe(false);
    expect(fixture.nativeElement.classList.contains('mobile')).toBe(false);
  });

  it('keeps user drawer toggles sticky within a window class and re-applies defaults on flip', async () => {
    const app = await createApp();

    await resizeTo('mobile');
    expect(app['leftOpened']()).toBe(false);

    // The user re-opens the entries drawer over the editor (mobile "over"
    // mode): the viewport effect only reacts to window-class changes.
    app['toggleLeft']();
    expect(app['leftOpened']()).toBe(true);

    await resizeTo('tablet');
    // Per-class defaults win again after the class flip.
    expect(app['leftOpened']()).toBe(true);
    expect(app['rightOpened']()).toBe(false);
  });

  it('wires the topbar drawer toggles to the sidenav signals', async () => {
    await workspace.createProject('Fuyuki');
    const app = await createApp();
    const host = fixture.nativeElement as HTMLElement;

    host.querySelector('[aria-label="Toggle entries panel"]')?.dispatchEvent(new Event('click'));
    expect(app['leftOpened']()).toBe(false);

    host.querySelector('[aria-label="Toggle history drawer"]')?.dispatchEvent(new Event('click'));
    expect(app['rightOpened']()).toBe(false);

    host.querySelector('[aria-label="Toggle entries panel"]')?.dispatchEvent(new Event('click'));
    expect(app['leftOpened']()).toBe(true);
  });

  it('marks the drawer closed in the shell when the sidenav itself closes', async () => {
    await workspace.createProject('Fuyuki');
    const app = await createApp();

    // Backdrop taps and Escape reduce to the sidenav closing itself.
    const left = fixture.debugElement.query(By.css('.entries-sidenav'));
    const sidenav = left?.componentInstance as MatSidenav;
    sidenav.close();
    await vi.waitFor(() => expect(app['leftOpened']()).toBe(false), { timeout: 5000 });
  });

  it('reclaims workspace scroll and focus when a drawer closes over focused content', async () => {
    await workspace.createProject('Fuyuki');
    const app = await createApp();
    const host = fixture.nativeElement as HTMLElement;

    const workspaceEl = host.querySelector<HTMLElement>('.workspace');
    assert(workspaceEl);
    // jsdom has no layout, so scrollLeft is a stub that ignores writes —
    // asserting it directly would be vacuous. Shadow the accessor with a
    // writable own property to observe the shell's write honestly; the
    // seeded value mimics the sideways focus-pan measured in e2e
    // (scrollLeft 105-276px at phone widths).
    Object.defineProperty(workspaceEl, 'scrollLeft', {
      value: 187,
      writable: true,
      configurable: true,
    });

    // Reproduce the doomed-focus state from the e2e audit: a control inside
    // the drawer holds focus when the drawer closes (the drawer's own
    // "New entry" button in the real repro).
    const doomed = await vi.waitFor(() => {
      const button = host.querySelector<HTMLButtonElement>(
        'app-entry-list [aria-label="New entry"]',
      );
      assert(button);
      return button;
    });
    doomed.focus();
    expect(document.activeElement).toBe(doomed);

    const left = fixture.debugElement.query(By.css('.entries-sidenav'));
    const sidenav = left?.componentInstance as MatSidenav;
    sidenav.close();
    await vi.waitFor(() => expect(app['leftOpened']()).toBe(false), { timeout: 4000 });

    // The close re-zeros the focus-pan the restore caused...
    expect(workspaceEl.scrollLeft).toBe(0);
    // ...and nothing stays focused inside the now-hidden pane (a parked
    // focus target would re-pan the workspace on the next Tab).
    expect(document.activeElement).toBe(document.body);
  });

  it('focuses the history drawer pane on phones so Escape can close it', async () => {
    // Boot straight into the phone class instead of resizing down from
    // desktop: a mid-test resize races the sidenav's pending close
    // animation-end against the re-open click (the same stale-transitionend
    // race the e2e helpers work around), which can flip the drawer shut
    // between the two. Booting mobile starts from a settled closed state.
    viewport.setViewport('mobile');
    await workspace.createProject('Fuyuki');
    const app = await createApp();
    await fixture.whenStable();
    // Let any boot-time simulated animation timer land before interacting
    // (jsdom has no real transitionend; Material completes via setTimeout).
    await new Promise((resolve) => setTimeout(resolve, 50));

    const host = fixture.nativeElement as HTMLElement;
    const bar = host.querySelector('app-mobile-bottom-bar');
    assert(bar);
    expect(bar.classList.contains('bar-hidden')).toBe(false);
    // The bar stays docked under the open drawer (backgrounded + inert), so
    // the tap that opens it leaves focus nowhere useful: a synthetic click
    // never focuses, and on a real phone inerting the focused bar item
    // releases focus to <body>. Either way the shell's pane-focus policy is
    // what must hand focus to the pane.
    expect(document.activeElement).toBe(document.body);

    const pane = host.querySelector<HTMLElement>('.history-sidenav');
    assert(pane);
    const historyNav = fixture.debugElement.query(By.css('.history-sidenav'))
      ?.componentInstance as MatSidenav;
    assert(historyNav);

    bar.querySelector('[aria-label="Toggle history drawer"]')?.dispatchEvent(new Event('click'));
    expect(app['rightOpened']()).toBe(true);

    // Wait out the sidenav's own open transition (simulated in jsdom — no
    // real transitionend exists) so the (opened) hook has run. waitFor's
    // timeout stays below the test timeout so a stuck open surfaces as an
    // assertion, not a bare timeout.
    await vi.waitFor(() => expect(historyNav.opened).toBe(true), { timeout: 4000 });

    // The phone pane-focus policy, deterministically for every open path:
    // once the drawer has opened, the shell focuses the pane itself
    // (Material stamps tabindex="-1" on over-mode drawers), and any
    // subsequent Material focus move (first-tabbable) stays within the pane
    // too. Asserting the end state inside the pane is the honest check —
    // pinning the exact element would depend on whether Material's deferred
    // focus move finds tabbable content.
    await vi.waitFor(() => expect(pane.contains(document.activeElement)).toBe(true), {
      timeout: 4000,
    });

    // End to end: Escape dispatched from the focused element (inside the
    // pane, bubbling to the pane's keydown listener) closes the drawer.
    const escape = new KeyboardEvent('keydown');
    Object.defineProperty(escape, 'keyCode', { value: ESCAPE });
    (document.activeElement as HTMLElement).dispatchEvent(escape);
    await vi.waitFor(() => expect(app['rightOpened']()).toBe(false), { timeout: 4000 });
  });

  it('focuses the entries drawer pane on phones so Escape can close it', async () => {
    // Same phone pane-focus policy, driven from the other open path: the
    // topbar hamburger persists across the toggle (nothing vanishes
    // mid-click), proving the policy is unconditional on phones rather
    // than a patch for a disappearing trigger.
    viewport.setViewport('mobile');
    await workspace.createProject('Fuyuki');
    const app = await createApp();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 50));

    const host = fixture.nativeElement as HTMLElement;
    const hamburger = host.querySelector<HTMLButtonElement>('[aria-label="Toggle entries panel"]');
    assert(hamburger);
    hamburger.dispatchEvent(new Event('click'));
    expect(app['leftOpened']()).toBe(true);

    const entriesNav = fixture.debugElement.query(By.css('.entries-sidenav'))
      ?.componentInstance as MatSidenav;
    assert(entriesNav);
    await vi.waitFor(() => expect(entriesNav.opened).toBe(true), { timeout: 4000 });

    const pane = host.querySelector<HTMLElement>('.entries-sidenav');
    assert(pane);
    await vi.waitFor(() => expect(pane.contains(document.activeElement)).toBe(true), {
      timeout: 4000,
    });

    // Escape from inside the pane closes the drawer — the fix for the
    // hamburger path, which never had working Escape on phones.
    const escape = new KeyboardEvent('keydown');
    Object.defineProperty(escape, 'keyCode', { value: ESCAPE });
    (document.activeElement as HTMLElement).dispatchEvent(escape);
    await vi.waitFor(() => expect(app['leftOpened']()).toBe(false), { timeout: 4000 });
  });

  it('leaves focus on a persistent trigger when a drawer opens from it', async () => {
    await workspace.createProject('Fuyuki');
    const app = await createApp();
    const host = fixture.nativeElement as HTMLElement;

    // Desktop steady state: the topbar history toggle holds focus and
    // persists across the toggle — the pane-focus policy is phone-only, so
    // it must not disturb focus here.
    const toggle = host.querySelector<HTMLButtonElement>('[aria-label="Toggle history drawer"]');
    assert(toggle);
    toggle.focus();
    expect(document.activeElement).toBe(toggle);

    // First click closes the default-open drawer, the second re-opens it.
    toggle.dispatchEvent(new Event('click'));
    await vi.waitFor(() => expect(app['rightOpened']()).toBe(false), { timeout: 5000 });
    toggle.dispatchEvent(new Event('click'));
    await vi.waitFor(() => expect(app['rightOpened']()).toBe(true), { timeout: 5000 });

    expect(document.activeElement).toBe(toggle);
  });

  it('activates focus mode on desktop and ends it when leaving the desktop class', async () => {
    await createApp();

    layout.toggleFocusMode();
    await fixture.whenStable();
    expect(layout.focusMode()).toBe(true);
    expect(fixture.nativeElement.classList.contains('focus-mode')).toBe(true);
    expect(layout.viewport()).toBe('desktop');

    // Shrinking the window ends focus mode instead of leaving a cramped editor.
    await resizeTo('tablet');
    expect(layout.focusMode()).toBe(false);
    expect(fixture.nativeElement.classList.contains('focus-mode')).toBe(false);
  });

  it('mounts the mobile bottom bar only on phones with an open project', async () => {
    await createApp();
    const compiled = fixture.nativeElement as HTMLElement;
    const bar = () => compiled.querySelector<HTMLElement>('app-mobile-bottom-bar');

    // Desktop class with no project: mounted (it self-hides) but out of flow.
    expect(bar()?.classList.contains('bar-hidden')).toBe(true);

    // Phones without a project: still hidden — there is nothing to act on.
    await resizeTo('mobile');
    expect(bar()?.classList.contains('bar-hidden')).toBe(true);

    // Phone + project: the five-item bar appears.
    await workspace.createProject('Fuyuki');
    await fixture.whenStable();
    expect(bar()?.classList.contains('bar-hidden')).toBe(false);
    expect(bar()?.querySelectorAll('.bar-item')).toHaveLength(5);

    // Back on desktop it hides again.
    await resizeTo('desktop');
    expect(bar()?.classList.contains('bar-hidden')).toBe(true);
  });

  it('routes the bottom bar history action to the history drawer', async () => {
    await workspace.createProject('Fuyuki');
    const app = await createApp();
    await resizeTo('mobile');
    await fixture.whenStable();

    const bar = (fixture.nativeElement as HTMLElement).querySelector('app-mobile-bottom-bar');
    assert(bar);
    expect(bar.classList.contains('bar-hidden')).toBe(false);
    expect(app['rightOpened']()).toBe(false);

    bar.querySelector('[aria-label="Toggle history drawer"]')?.dispatchEvent(new Event('click'));
    expect(app['rightOpened']()).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Batch swap (Task 06 §3.2): the barState machine over drawers + selection.
  // -------------------------------------------------------------------------

  /** Boots the phone shell with a two-entry project and an open entries drawer. */
  async function createPhoneShellWithSelection(): Promise<App> {
    viewport.setViewport('mobile');
    await workspace.createProject('Fuyuki');
    workspace.addEntry();
    workspace.addEntry();
    const app = await createApp();
    await fixture.whenStable();
    // Let any boot-time simulated animation timer land before interacting
    // (jsdom has no real transitionend; Material completes via setTimeout).
    await new Promise((resolve) => setTimeout(resolve, 50));
    const list = app['entryList']();
    assert(list);
    app['toggleLeft']();
    return app;
  }

  it('walks the bar through normal, backgrounded and batch as drawers and the selection change', async () => {
    const app = await createPhoneShellWithSelection();
    const list = app['entryList']();
    assert(list);

    // Entries drawer open, nothing selected: backgrounded (visible, inert).
    expect(app['barState']()).toBe('backgrounded');

    // A selection arrives while the history drawer is closed: batch.
    list.selectAllShown(true);
    expect(app['barState']()).toBe('batch');
    await fixture.whenStable();
    fixture.detectChanges();
    const bar = (fixture.nativeElement as HTMLElement).querySelector('app-mobile-bottom-bar');
    assert(bar);
    expect(bar.classList.contains('bar-batch')).toBe(true);
    expect(bar.classList.contains('bar-backgrounded')).toBe(false);
    expect(bar.querySelector('.batch-bar')).toBeTruthy();
    expect(bar.querySelector('nav.bar')).toBeNull();
    // Task 12 §5.2: the swapped strip carries six batch actions.
    expect(bar.querySelectorAll('.bar-item')).toHaveLength(6);

    // The swap needs the history drawer closed: opening it veils the bar.
    app['toggleRight']();
    expect(app['barState']()).toBe('backgrounded');
    app['toggleRight']();
    expect(app['barState']()).toBe('batch');

    // The bar's ✕ clears the selection (entries drawer still open):
    // backgrounded again, with the five items back.
    await app['runBatchBarAction']('clear-selection');
    expect(app['barState']()).toBe('backgrounded');
    expect(list.selectionCount()).toBe(0);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(bar.querySelector('.batch-bar')).toBeNull();

    // Drawer closes: normal again.
    app['toggleLeft']();
    expect(app['barState']()).toBe('normal');
  });

  it('recovers the entries-pane focus after the bar clears the selection mid-tap', async () => {
    const app = await createPhoneShellWithSelection();
    const list = app['entryList']();
    assert(list);
    list.selectAllShown(true);
    expect(app['barState']()).toBe('batch');

    // The ✕ tap: clear-selection collapses the count to 0, flipping batch →
    // backgrounded and unmounting the tapped control — focus falls to
    // <body> under the now-inert strip. The shell re-focuses the entries
    // pane (mirror of the drawer-open focus policy), so Escape keeps
    // working after the swap collapses.
    await app['runBatchBarAction']('clear-selection');
    expect(app['barState']()).toBe('backgrounded');
    const pane = (fixture.nativeElement as HTMLElement).querySelector('.entries-sidenav');
    assert(pane);
    expect(pane.contains(document.activeElement)).toBe(true);
  });

  it('keeps batch under the delete confirm dialog and recovers pane focus after it resolves', async () => {
    const app = await createPhoneShellWithSelection();
    const list = app['entryList']();
    assert(list);
    list.selectAllShown(true);
    expect(app['barState']()).toBe('batch');

    // The delete confirmation is held open by a deferred subject.
    const confirmed = new Subject<boolean>();
    const openDialog = vi.spyOn(TestBed.inject(MatDialog), 'open').mockReturnValue({
      afterClosed: () => confirmed,
    } as never);

    void app['runBatchBarAction']('delete-selection');
    await vi.waitFor(() => expect(openDialog).toHaveBeenCalledTimes(1), { timeout: 4000 });

    // §7.6: the bar stays `batch` under the open dialog — CDK overlays
    // cover and dim the strip themselves; the computed has no overlay
    // member and nothing special-cases the dialog away.
    expect(app['barState']()).toBe('batch');

    confirmed.next(true);
    confirmed.complete();
    // The delete resolves: entries gone, selection cleared → backgrounded,
    // and the entries pane holds focus again (the batch-swap focus
    // recovery waits for the async dialog, unlike the sync clear path).
    await vi.waitFor(() => expect(app['barState']()).toBe('backgrounded'), { timeout: 4000 });
    expect(list.selectionCount()).toBe(0);
    expect(workspace.entries()).toHaveLength(0);
    const pane = (fixture.nativeElement as HTMLElement).querySelector('.entries-sidenav');
    assert(pane);
    await vi.waitFor(() => expect(pane.contains(document.activeElement)).toBe(true), {
      timeout: 4000,
    });
  });

  it('leaves the swap and its trigger alive when the delete confirm is cancelled', async () => {
    const app = await createPhoneShellWithSelection();
    const list = app['entryList']();
    assert(list);
    list.selectAllShown(true);

    // The delete confirmation is held open by a deferred subject, then
    // cancelled — `deleteSelection` resolves without clearing.
    const cancelled = new Subject<boolean>();
    const openDialog = vi.spyOn(TestBed.inject(MatDialog), 'open').mockReturnValue({
      afterClosed: () => cancelled,
    } as never);
    const deleteSpy = vi.spyOn(workspace, 'deleteEntries');

    void app['runBatchBarAction']('delete-selection');
    await vi.waitFor(() => expect(openDialog).toHaveBeenCalledTimes(1), { timeout: 4000 });
    cancelled.next(false);
    cancelled.complete();
    // Let the floating handler's continuation (the recovery decision) run
    // before asserting — without this tick the guard's choice is unobserved.
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // A cancelled confirm keeps `selectionCount()` (and with it the batch
    // swap) alive: the shell's collapse-focus recovery does not apply —
    // nothing unmounted under the tap, so Material restores focus onto the
    // bar's own trigger and the shell must not steal it into the pane. That
    // focus fact is unobservable in jsdom (Material's own sidenav focus trap
    // parks focus inside the open pane regardless — the sibling confirmed
    // test waits for exactly that), so the cancel path is pinned by its
    // discriminating facts: the delete did not run and the selection the
    // swap edits survived with the bar still foregrounded.
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(list.selectionCount()).toBe(2);
    expect(app['barState']()).toBe('batch');
  });

  it('routes every batch action leaf to the EntryList public method that owns it', async () => {
    const app = await createPhoneShellWithSelection();
    const list = app['entryList']();
    assert(list);
    const openSpy = vi.spyOn(list, 'openBatchOperations').mockResolvedValue(undefined);
    const delimitersSpy = vi.spyOn(list, 'openDelimiters').mockResolvedValue(undefined);
    const exportSpy = vi.spyOn(list, 'exportSelection').mockImplementation(() => undefined);
    const duplicateSpy = vi.spyOn(list, 'duplicateSelection').mockImplementation(() => undefined);
    const enabledSpy = vi.spyOn(list, 'setSelectionEnabled').mockImplementation(() => undefined);
    const selectAllSpy = vi.spyOn(list, 'selectAllShown'); // calls through

    await app['runBatchBarAction']('batch-edit');
    await app['runBatchBarAction']('delimiters-selection');
    await app['runBatchBarAction']('export-selected');
    // Deliberate no-op (the bar's more_vert opens its own menu in place).
    await app['runBatchBarAction']('more-batch-actions');
    await app['runBatchBarAction']('duplicate-selection');
    await app['runBatchBarAction']('enable-selection');
    await app['runBatchBarAction']('disable-selection');
    await app['runBatchBarAction']('select-all-shown');

    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(delimitersSpy).toHaveBeenCalledTimes(1);
    expect(exportSpy).toHaveBeenCalledTimes(1);
    expect(duplicateSpy).toHaveBeenCalledTimes(1);
    expect(enabledSpy).toHaveBeenCalledTimes(2);
    expect(enabledSpy).toHaveBeenNthCalledWith(1, true);
    expect(enabledSpy).toHaveBeenNthCalledWith(2, false);
    // The bare select-all member resolves against the public tri-state fact:
    // nothing selected yet, so the tap means select-the-shown.
    expect(selectAllSpy).toHaveBeenCalledWith(true);
    expect(list.selectionCount()).toBe(2);

    // With everything shown already selected the same member means
    // deselect-shown — the drawer checkbox's own semantics.
    await app['runBatchBarAction']('select-all-shown');
    expect(selectAllSpy).toHaveBeenLastCalledWith(false);
    expect(list.selectionCount()).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Entries drawer resize (task 21 D3): clamp, keyboard steps, persistence
  // and the handle's band presence. The pointer-drag specs stub the capture
  // methods (jsdom has none) and drive synthetic pointer events — jsdom has
  // no layout, so the drawer's rect is 0 and the width under the pointer is
  // the pointer's clientX, clamped.
  // -------------------------------------------------------------------------

  it('reads the persisted drawer width at startup, clamped into the 320-480 range', async () => {
    const cases: [string, number][] = [
      ['456', 456],
      ['9999', 480],
      ['100', 320],
      ['not-a-number', 320],
      ['', 320],
    ];
    for (const [stored, expected] of cases) {
      storage.set(ENTRIES_WIDTH_KEY, stored);
      const app = await createApp();
      expect(app['entriesWidth'](), `stored "${stored}"`).toBe(expected);
      fixture.destroy();
    }

    // No stored value: the designed 320px default.
    const app = await createApp();
    expect(app['entriesWidth']()).toBe(320);
  });

  it('renders the resize handle on non-mobile bands with the locked a11y contract and removes it on mobile', async () => {
    await workspace.createProject('Fuyuki');
    await createApp();
    const host = fixture.nativeElement as HTMLElement;
    const selector = '[aria-label="Resize entries panel"]';

    // Desktop default: present, with the full a11y contract.
    const handle = host.querySelector<HTMLElement>(selector);
    assert(handle);
    expect(handle.getAttribute('role')).toBe('separator');
    expect(handle.getAttribute('aria-orientation')).toBe('vertical');
    expect(handle.getAttribute('aria-valuemin')).toBe('320');
    expect(handle.getAttribute('aria-valuemax')).toBe('480');
    expect(handle.getAttribute('aria-valuenow')).toBe('320');
    expect(handle.getAttribute('tabindex')).toBe('0');

    // Mobile band: removed from the DOM (responsive-shape contract), never
    // display:none — and the inline width binding yields null there so the
    // CSS full-width contract stands.
    await resizeTo('mobile');
    fixture.detectChanges();
    expect(host.querySelector(selector)).toBeNull();
    const pane = host.querySelector<HTMLElement>('.entries-sidenav');
    assert(pane);
    expect(pane.style.width).toBe('');

    // Back on desktop the handle returns, still bound to the live width.
    await resizeTo('desktop');
    fixture.detectChanges();
    const returned = host.querySelector<HTMLElement>(selector);
    assert(returned);
    expect(returned.getAttribute('aria-valuenow')).toBe('320');
  });

  it('steps the width live with the arrow keys but persists only on keyup', async () => {
    await workspace.createProject('Fuyuki');
    const app = await createApp();
    const handle = resizeHandle();

    // ArrowRight steps +8px live and reaches the drawer's inline style...
    handle.dispatchEvent(spiedKeydown('ArrowRight'));
    expect(app['entriesWidth']()).toBe(328);
    fixture.detectChanges();
    expect(entriesPaneInlineWidth()).toBe('328px');
    // ...but the storage write waits for keyup (the keyup-commit contract).
    expect(storage.has(ENTRIES_WIDTH_KEY)).toBe(false);

    handle.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight' }));
    expect(storage.get(ENTRIES_WIDTH_KEY)).toBe('328');

    // A keyup with no keyboard resize in flight writes nothing.
    handle.dispatchEvent(new KeyboardEvent('keyup', { key: 'a' }));
    expect(storage.get(ENTRIES_WIDTH_KEY)).toBe('328');
  });

  it('clamps keyboard resizing at the 320 and 480 bounds (Home/End and arrows beyond)', async () => {
    await workspace.createProject('Fuyuki');
    const app = await createApp();
    const handle = resizeHandle();

    // End jumps to the max; further ArrowRight presses stay clamped there.
    handle.dispatchEvent(spiedKeydown('End'));
    handle.dispatchEvent(spiedKeydown('ArrowRight'));
    expect(app['entriesWidth']()).toBe(480);
    handle.dispatchEvent(new KeyboardEvent('keyup', { key: 'End' }));
    expect(storage.get(ENTRIES_WIDTH_KEY)).toBe('480');

    // Home jumps to the min; further ArrowLeft presses stay clamped there.
    handle.dispatchEvent(spiedKeydown('Home'));
    handle.dispatchEvent(spiedKeydown('ArrowLeft'));
    expect(app['entriesWidth']()).toBe(320);
    handle.dispatchEvent(new KeyboardEvent('keyup', { key: 'Home' }));
    expect(storage.get(ENTRIES_WIDTH_KEY)).toBe('320');
  });

  it('preventDefaults exactly the resize keys so the page never scrolls mid-resize', async () => {
    await workspace.createProject('Fuyuki');
    await createApp();
    const handle = resizeHandle();

    for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) {
      const down = spiedKeydown(key);
      handle.dispatchEvent(down);
      expect(down.preventDefault).toHaveBeenCalledTimes(1);
    }

    // Any other key keeps its native behavior.
    const other = spiedKeydown('a');
    handle.dispatchEvent(other);
    expect(other.preventDefault).not.toHaveBeenCalled();
  });

  it('round-trips a committed width through storage into a fresh shell', async () => {
    await workspace.createProject('Fuyuki');
    const app = await createApp();
    const handle = resizeHandle();

    handle.dispatchEvent(spiedKeydown('End'));
    handle.dispatchEvent(new KeyboardEvent('keyup', { key: 'End' }));
    expect(storage.get(ENTRIES_WIDTH_KEY)).toBe('480');
    fixture.detectChanges();
    expect(entriesPaneInlineWidth()).toBe('480px');
    void app;

    // A fresh shell reads the committed width back, still applied inline.
    fixture.destroy();
    await createApp();
    fixture.detectChanges();
    expect(entriesPaneInlineWidth()).toBe('480px');
  });

  it('swallows storage failures on both the startup read and the commit write', async () => {
    installThrowingStorage();
    await workspace.createProject('Fuyuki');
    const app = await createApp();
    // The startup read threw: the designed default survives.
    expect(app['entriesWidth']()).toBe(320);

    const handle = resizeHandle();
    handle.dispatchEvent(spiedKeydown('End'));
    expect(app['entriesWidth']()).toBe(480);
    // The commit write threw too: swallowed, the width lasts the session.
    expect(() => handle.dispatchEvent(new KeyboardEvent('keyup', { key: 'End' }))).not.toThrow();
    expect(app['entriesWidth']()).toBe(480);
  });

  it('resizes by pointer drag with live clamping and commits on release', async () => {
    await workspace.createProject('Fuyuki');
    const app = await createApp();
    const handle = resizeHandle();
    stubPointerCapture(handle);

    // Stray moves/releases/cancels with no drag in flight are ignored.
    handle.dispatchEvent(pointerEvent('pointermove', 400));
    expect(app['entriesWidth']()).toBe(320);
    handle.dispatchEvent(pointerEvent('pointerup', 400));
    expect(storage.has(ENTRIES_WIDTH_KEY)).toBe(false);
    handle.dispatchEvent(pointerEvent('pointercancel', 400));
    expect(app['entriesWidth']()).toBe(320);

    handle.dispatchEvent(pointerEvent('pointerdown', 320));
    expect(document.body.classList.contains('entries-resize-active')).toBe(true);
    // pointerdown alone never resizes; the first move does. Live clamps:
    handle.dispatchEvent(pointerEvent('pointermove', 400));
    expect(app['entriesWidth']()).toBe(400);
    handle.dispatchEvent(pointerEvent('pointermove', 9999));
    expect(app['entriesWidth']()).toBe(480);
    handle.dispatchEvent(pointerEvent('pointermove', 5));
    expect(app['entriesWidth']()).toBe(320);

    handle.dispatchEvent(pointerEvent('pointerup', 5));
    expect(storage.get(ENTRIES_WIDTH_KEY)).toBe('320');
    expect(document.body.classList.contains('entries-resize-active')).toBe(false);
  });

  it('ignores a second pointer while a drag is in flight', async () => {
    await workspace.createProject('Fuyuki');
    const app = await createApp();
    const handle = resizeHandle();
    stubPointerCapture(handle);

    handle.dispatchEvent(pointerEvent('pointerdown', 320));
    // A second pointer must not hijack the active drag: the later move/up
    // still track pointer 1, so the width follows them, not the 2nd down.
    handle.dispatchEvent(pointerEvent('pointerdown', 9999, 2));
    handle.dispatchEvent(pointerEvent('pointermove', 350));
    expect(app['entriesWidth']()).toBe(350);
    handle.dispatchEvent(pointerEvent('pointerup', 350));
    expect(storage.get(ENTRIES_WIDTH_KEY)).toBe('350');
    expect(document.body.classList.contains('entries-resize-active')).toBe(false);
  });

  it('ends a cancelled drag without committing and keeps the next drag working', async () => {
    await workspace.createProject('Fuyuki');
    const app = await createApp();
    const handle = resizeHandle();
    stubPointerCapture(handle);

    handle.dispatchEvent(pointerEvent('pointerdown', 320));
    handle.dispatchEvent(pointerEvent('pointermove', 400));
    handle.dispatchEvent(pointerEvent('pointercancel', 400));
    // The live width stays, but the gesture was not committed...
    expect(app['entriesWidth']()).toBe(400);
    expect(storage.has(ENTRIES_WIDTH_KEY)).toBe(false);
    expect(document.body.classList.contains('entries-resize-active')).toBe(false);

    // ...and the next gesture starts cleanly.
    handle.dispatchEvent(pointerEvent('pointerdown', 320));
    handle.dispatchEvent(pointerEvent('pointermove', 350));
    handle.dispatchEvent(pointerEvent('pointerup', 350));
    expect(storage.get(ENTRIES_WIDTH_KEY)).toBe('350');
  });

  it('resets to the 320px default on double-click and commits the reset', async () => {
    await workspace.createProject('Fuyuki');
    const app = await createApp();
    const handle = resizeHandle();
    stubPointerCapture(handle);

    handle.dispatchEvent(pointerEvent('pointerdown', 320));
    handle.dispatchEvent(pointerEvent('pointermove', 440));
    handle.dispatchEvent(pointerEvent('pointerup', 440));
    expect(storage.get(ENTRIES_WIDTH_KEY)).toBe('440');

    handle.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(app['entriesWidth']()).toBe(320);
    expect(storage.get(ENTRIES_WIDTH_KEY)).toBe('320');
  });

  it('cleans the body drag chrome when the shell is destroyed mid-drag', async () => {
    await workspace.createProject('Fuyuki');
    await createApp();
    const handle = resizeHandle();
    stubPointerCapture(handle);

    handle.dispatchEvent(pointerEvent('pointerdown', 320));
    expect(document.body.classList.contains('entries-resize-active')).toBe(true);

    // DestroyRef cleanup: no leaked body styles after a mid-drag teardown.
    fixture.destroy();
    expect(document.body.classList.contains('entries-resize-active')).toBe(false);
  });
});
