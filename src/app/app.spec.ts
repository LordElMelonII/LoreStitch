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

describe('App', () => {
  let workspace: WorkspaceService;
  let layout: LayoutService;
  let viewport: { setViewport: (viewport: ViewportClass) => void };

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

  beforeEach(async () => {
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
    expect(bar.querySelectorAll('.bar-item')).toHaveLength(0);

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

  it('routes every batch action leaf to the EntryList public method that owns it', async () => {
    const app = await createPhoneShellWithSelection();
    const list = app['entryList']();
    assert(list);
    const openSpy = vi.spyOn(list, 'openBatchOperations').mockResolvedValue(undefined);
    const exportSpy = vi.spyOn(list, 'exportSelection').mockImplementation(() => undefined);
    const duplicateSpy = vi.spyOn(list, 'duplicateSelection').mockImplementation(() => undefined);
    const enabledSpy = vi.spyOn(list, 'setSelectionEnabled').mockImplementation(() => undefined);
    const selectAllSpy = vi.spyOn(list, 'selectAllShown'); // calls through

    await app['runBatchBarAction']('batch-edit');
    await app['runBatchBarAction']('export-selected');
    // Deliberate no-op (the bar's more_vert opens its own menu in place).
    await app['runBatchBarAction']('more-batch-actions');
    await app['runBatchBarAction']('duplicate-selection');
    await app['runBatchBarAction']('enable-selection');
    await app['runBatchBarAction']('disable-selection');
    await app['runBatchBarAction']('select-all-shown');

    expect(openSpy).toHaveBeenCalledTimes(1);
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
});
