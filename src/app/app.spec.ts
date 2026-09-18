import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { DomSanitizer } from '@angular/platform-browser';
import { ANIMATION_MODULE_TYPE } from '@angular/core';
import { MatIconRegistry } from '@angular/material/icon';
import { MatSidenav } from '@angular/material/sidenav';
import { ESCAPE } from '@angular/cdk/keycodes';
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
  const registered: { query: string; listeners: Set<(event: { matches: boolean }) => void> }[] =
    [];
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
    await vi.waitFor(
      () => expect(compiled.querySelector('app-commit-history')).toBeTruthy(),
      { timeout: 5000 },
    );
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

  it('focuses the history drawer opened from the bottom bar so Escape can close it', async () => {
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
    // The bug's precondition: nothing holds focus. The bar item that opens
    // the drawer unstamps itself mid-click; real browsers land on <body>
    // via the focus-fixup rule, and a synthetic click never focuses at all.
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

    // Focus now sits inside the drawer pane: the shell focuses the pane
    // itself when the trigger vanished (Material stamps tabindex="-1" on
    // over-mode drawers), and any subsequent Material focus move
    // (first-tabbable) stays within the pane too. Asserting the end state
    // inside the pane is the honest check — pinning the exact element would
    // depend on whether Material's deferred focus move finds tabbable
    // content.
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

  it('leaves focus on a persistent trigger when a drawer opens from it', async () => {
    await workspace.createProject('Fuyuki');
    const app = await createApp();
    const host = fixture.nativeElement as HTMLElement;

    // Desktop steady state: the topbar history toggle holds focus and
    // persists across the toggle — the shell's (opened) hook must not
    // disturb it (the body guard only fires when the trigger vanished).
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
});
