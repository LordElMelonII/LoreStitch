import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { DomSanitizer } from '@angular/platform-browser';
import { MatIconRegistry } from '@angular/material/icon';
import { MatSidenav } from '@angular/material/sidenav';
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
