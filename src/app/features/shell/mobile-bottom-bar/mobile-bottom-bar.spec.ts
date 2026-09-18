import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MatMenuTrigger } from '@angular/material/menu';
import { WorkspaceService } from '../../../core/services/workspace.service';
import { ProjectActionsService } from '../project-actions.service';
import {
  DESKTOP_BREAKPOINT_QUERY,
  MOBILE_BREAKPOINT_QUERY,
} from '../../../shared/constants/breakpoints';
import { MobileBottomBar, MobileBarAction } from './mobile-bottom-bar';

/**
 * jsdom has no matchMedia; install a stub whose desktop/mobile answers can be
 * flipped mid-test (the CDK observer reacts to change events, exactly like a
 * browser).
 */
function installMatchMediaStub(): {
  setDesktop: (matches: boolean) => void;
  setMobile: (matches: boolean) => void;
} {
  const state = new Map<string, boolean>([
    [DESKTOP_BREAKPOINT_QUERY, false],
    [MOBILE_BREAKPOINT_QUERY, false],
  ]);
  /** Listeners keyed by the query they observe: flips notify each with its own answer. */
  const listeners = new Map<string, Set<(event: { matches: boolean }) => void>>();
  const fake = (query: string) => ({
    get matches() {
      return state.get(query) ?? false;
    },
    media: query,
    onchange: null,
    addListener: (cb: (event: { matches: boolean }) => void) => {
      const set = listeners.get(query) ?? new Set();
      set.add(cb);
      listeners.set(query, set);
    },
    removeListener: (cb: unknown) => listeners.get(query)?.delete(cb as never),
    addEventListener: (_: string, cb: (event: { matches: boolean }) => void) =>
      listeners.get(query)?.add(cb),
    removeEventListener: (_: string, cb: unknown) => listeners.get(query)?.delete(cb as never),
    dispatchEvent: () => false,
  });
  Object.defineProperty(window, 'matchMedia', { writable: true, value: fake });
  const setQuery = (query: string, matches: boolean) => {
    state.set(query, matches);
    for (const cb of listeners.get(query) ?? []) {
      cb({ matches });
    }
  };
  return {
    setDesktop: (matches) => setQuery(DESKTOP_BREAKPOINT_QUERY, matches),
    setMobile: (matches) => setQuery(MOBILE_BREAKPOINT_QUERY, matches),
  };
}

describe('MobileBottomBar', () => {
  let workspace: WorkspaceService;
  let viewport: ReturnType<typeof installMatchMediaStub>;
  let barFixture: ComponentFixture<MobileBottomBar>;

  async function createBar(options?: {
    overlayOpen?: boolean;
    drawerOpen?: boolean;
  }): Promise<MobileBottomBar> {
    barFixture = TestBed.createComponent(MobileBottomBar);
    if (options?.overlayOpen) {
      barFixture.componentRef.setInput('overlayOpen', true);
    }
    if (options?.drawerOpen) {
      barFixture.componentRef.setInput('drawerOpen', true);
    }
    await barFixture.whenStable();
    barFixture.detectChanges();
    return barFixture.componentInstance;
  }

  /** Flips the fake window class and waits out the CDK observer's throttle. */
  async function resizeTo(mobile: boolean): Promise<void> {
    viewport.setMobile(mobile);
    viewport.setDesktop(!mobile);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await barFixture.whenStable();
    barFixture.detectChanges();
  }

  /** Pins the phone class before the component mounts. */
  async function resizeToMobile(): Promise<void> {
    viewport.setMobile(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  function host(): HTMLElement {
    return barFixture.nativeElement as HTMLElement;
  }

  function itemButtons(): HTMLButtonElement[] {
    return [...host().querySelectorAll<HTMLButtonElement>('.bar-item')];
  }

  beforeEach(async () => {
    viewport = installMatchMediaStub();
    await TestBed.configureTestingModule({
      imports: [MobileBottomBar],
    }).compileComponents();
    workspace = TestBed.inject(WorkspaceService);
    // Allow the workspace's async init() to settle.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('stays hidden on desktop viewports', async () => {
    await workspace.createProject('Fuyuki');
    await createBar();
    await resizeTo(false);

    expect(host().classList.contains('bar-hidden')).toBe(true);
  });

  it('stays hidden on phones without an open project and appears once one opens', async () => {
    await resizeToMobile();
    await createBar();
    expect(host().classList.contains('bar-hidden')).toBe(true);

    await workspace.createProject('Fuyuki');
    await barFixture.whenStable();
    barFixture.detectChanges();
    expect(host().classList.contains('bar-hidden')).toBe(false);
  });

  it('hides while the overlay-open input is set and returns when it clears', async () => {
    await workspace.createProject('Fuyuki');
    await resizeToMobile();
    await createBar();
    expect(host().classList.contains('bar-hidden')).toBe(false);

    barFixture.componentRef.setInput('overlayOpen', true);
    await barFixture.whenStable();
    barFixture.detectChanges();
    expect(host().classList.contains('bar-hidden')).toBe(true);

    barFixture.componentRef.setInput('overlayOpen', false);
    await barFixture.whenStable();
    barFixture.detectChanges();
    expect(host().classList.contains('bar-hidden')).toBe(false);
  });

  it('hides while the drawer-open input is set and returns when it clears', async () => {
    await workspace.createProject('Fuyuki');
    await resizeToMobile();
    await createBar();
    expect(host().classList.contains('bar-hidden')).toBe(false);

    // An over-mode drawer's scrim cannot cover the bar (it lives outside the
    // sidenav container), so the bar removes itself while a drawer is open.
    barFixture.componentRef.setInput('drawerOpen', true);
    await barFixture.whenStable();
    barFixture.detectChanges();
    expect(host().classList.contains('bar-hidden')).toBe(true);

    barFixture.componentRef.setInput('drawerOpen', false);
    await barFixture.whenStable();
    barFixture.detectChanges();
    expect(host().classList.contains('bar-hidden')).toBe(false);
  });

  it('renders five icon-over-label items', async () => {
    await workspace.createProject('Fuyuki');
    await resizeToMobile();
    await createBar();

    const items = itemButtons();
    expect(items).toHaveLength(5);
    const labels = [...host().querySelectorAll<HTMLElement>('.bar-label')].map(
      (label) => label.textContent,
    );
    expect(labels).toEqual(['New entry', 'Search', 'Export', 'Batch edit', 'History']);
  });

  it('emits the matching action when an item runs', async () => {
    await workspace.createProject('Fuyuki');
    await resizeToMobile();
    const bar = await createBar();
    const emitted: MobileBarAction[] = [];
    bar.action.subscribe((action) => emitted.push(action));

    // Export is a menu trigger (covered below), so click the four routed
    // items by their order in the bar.
    const [newEntry, searchReplace, , batch, history] = itemButtons();
    newEntry?.click();
    searchReplace?.click();
    batch?.click();
    history?.click();
    barFixture.detectChanges();

    expect(emitted).toEqual(['new-entry', 'search-replace', 'batch', 'history']);
  });

  it('opens the five-entry export menu above the bar and routes it through the actions service', async () => {
    await workspace.createProject('Fuyuki');
    await resizeToMobile();
    await createBar();
    const exportStNative = vi
      .spyOn(TestBed.inject(ProjectActionsService), 'exportStNative')
      .mockImplementation(() => undefined);

    const exportTrigger = itemButtons()[2];
    assert(exportTrigger);
    // The trigger is a bar button, NOT a nested mat-menu-item: the touch-safe
    // nested-trigger directive must not be present (its doc forbids it on
    // standalone triggers).
    expect(exportTrigger.hasAttribute('ng-reflect-app-touch-safe-nested-menu-trigger')).toBe(
      false,
    );

    const triggerDebug = barFixture.debugElement.queryAll(By.css('.bar-item'))[2];
    assert(triggerDebug);
    triggerDebug.injector.get(MatMenuTrigger).openMenu();
    barFixture.detectChanges();

    const menuText = document.querySelector('.mat-mdc-menu-panel')?.textContent ?? '';
    expect(menuText).toContain('World Info JSON');
    expect(menuText).toContain('Project archive (.stproj)');
    expect(menuText).toContain('Export selected entries…');
    expect(menuText).toContain('Character Book JSON');
    expect(menuText).toContain('Proofread digest (Markdown)');

    // The menu items call the shared service wrappers — the one logic home.
    const worldInfo = [...document.querySelectorAll('.mat-mdc-menu-panel button')].find((button) =>
      button.textContent?.includes('World Info JSON'),
    );
    assert(worldInfo);
    worldInfo.dispatchEvent(new Event('click'));
    barFixture.detectChanges();
    expect(exportStNative).toHaveBeenCalledTimes(1);
  });

  it('badges the history item while there are uncommitted changes', async () => {
    await workspace.createProject('Fuyuki');
    await resizeToMobile();
    await createBar();
    expect(host().querySelector('.bar-item .mat-badge-content')).toBeNull();

    workspace.addEntry();
    barFixture.detectChanges();

    const badge = host()
      .querySelector('[aria-label="Toggle history drawer"]')
      ?.querySelector('.mat-badge-content');
    expect(badge?.textContent).toBe('!');
  });
});
