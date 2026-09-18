import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WorkspaceService } from '../../../core/services/workspace.service';
import {
  DESKTOP_BREAKPOINT_QUERY,
  MOBILE_BREAKPOINT_QUERY,
} from '../../../shared/constants/breakpoints';
import { MobileFab, MobileFabAction } from './mobile-fab';

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

describe('MobileFab', () => {
  let workspace: WorkspaceService;
  let viewport: ReturnType<typeof installMatchMediaStub>;
  let fixture: ComponentFixture<MobileFab>;

  async function createFab(options?: {
    overlayOpen?: boolean;
    drawerOpen?: boolean;
  }): Promise<MobileFab> {
    fixture = TestBed.createComponent(MobileFab);
    if (options?.overlayOpen) {
      fixture.componentRef.setInput('overlayOpen', true);
    }
    if (options?.drawerOpen) {
      fixture.componentRef.setInput('drawerOpen', true);
    }
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  /** Flips the fake window class and waits out the CDK observer's throttle. */
  async function resizeTo(mobile: boolean): Promise<void> {
    viewport.setMobile(mobile);
    viewport.setDesktop(!mobile);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  /** Pins the phone class before the component mounts. */
  async function resizeToMobile(): Promise<void> {
    viewport.setMobile(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  /** Expands through the real toggle button. */
  async function expand(): Promise<void> {
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.fab-toggle')?.click();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    viewport = installMatchMediaStub();
    await TestBed.configureTestingModule({
      imports: [MobileFab],
    }).compileComponents();
    workspace = TestBed.inject(WorkspaceService);
    // Allow the workspace's async init() to settle.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('stays hidden on desktop viewports', async () => {
    await workspace.createProject('Fuyuki');
    await createFab();
    viewport.setDesktop(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).classList.contains('fab-hidden')).toBe(true);
  });

  it('stays hidden on phones without an open project and appears once one opens', async () => {
    await resizeToMobile();
    await createFab();
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.classList.contains('fab-hidden')).toBe(true);

    await workspace.createProject('Fuyuki');
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
    expect(host.classList.contains('fab-hidden')).toBe(false);
  });

  it('hides while the overlay-open input is set and returns when it clears', async () => {
    await workspace.createProject('Fuyuki');
    await resizeToMobile();
    await createFab();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.classList.contains('fab-hidden')).toBe(false);

    fixture.componentRef.setInput('overlayOpen', true);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(host.classList.contains('fab-hidden')).toBe(true);

    fixture.componentRef.setInput('overlayOpen', false);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(host.classList.contains('fab-hidden')).toBe(false);
  });

  it('expands into four labelled actions and keeps collapsed rows inert', async () => {
    await workspace.createProject('Fuyuki');
    await resizeToMobile();
    const fab = await createFab();

    const host = fixture.nativeElement as HTMLElement;
    const toggle = host.querySelector<HTMLButtonElement>('.fab-toggle');
    assert(toggle);
    // Collapsed: the stack exists (aria-controls must resolve) but is inert.
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-controls')).toBe('mobile-fab-stack');
    expect(host.querySelector('.fab-stack')?.hasAttribute('inert')).toBe(true);

    await expand();
    expect(fab['expanded']()).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(host.querySelector('.fab-stack')?.hasAttribute('inert')).toBe(false);

    const rows = [...host.querySelectorAll<HTMLButtonElement>('.fab-row-button')];
    expect(rows).toHaveLength(4);
    const labels = [...host.querySelectorAll<HTMLElement>('.fab-label')].map(
      (label) => label.textContent,
    );
    expect(labels).toEqual(['New entry', 'Search & replace', 'Export entries', 'Batch edit']);
    // Each row button is announced by its visible label.
    expect(rows[0]?.getAttribute('aria-labelledby')).toBe('mobile-fab-label-new-entry');
  });

  it('collapses on Escape', async () => {
    await workspace.createProject('Fuyuki');
    await resizeToMobile();
    const fab = await createFab();
    await expand();
    expect(fab['expanded']()).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(fab['expanded']()).toBe(false);
  });

  it('emits the matching action and collapses when a row runs', async () => {
    await workspace.createProject('Fuyuki');
    await resizeToMobile();
    const fab = await createFab();
    const emitted: MobileFabAction[] = [];
    fab.action.subscribe((action) => emitted.push(action));
    await expand();

    const rows = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('.fab-row-button'),
    ];
    for (const row of rows) {
      row.click();
    }
    fixture.detectChanges();

    expect(emitted).toEqual(['new-entry', 'search-replace', 'export', 'batch']);
    expect(fab['expanded']()).toBe(false);
  });

  it('folds the stack when a drawer opens (input) while expanded', async () => {
    await workspace.createProject('Fuyuki');
    await resizeToMobile();
    const fab = await createFab();
    await expand();
    expect(fab['expanded']()).toBe(true);

    fixture.componentRef.setInput('drawerOpen', true);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fab['expanded']()).toBe(false);
    // The collapsed FAB itself stays visible beside the drawer.
    expect((fixture.nativeElement as HTMLElement).classList.contains('fab-hidden')).toBe(false);
  });

  it('re-hides when the viewport leaves the phone class while mounted', async () => {
    await workspace.createProject('Fuyuki');
    await createFab();
    await resizeTo(true);
    expect((fixture.nativeElement as HTMLElement).classList.contains('fab-hidden')).toBe(false);

    await resizeTo(false);
    expect((fixture.nativeElement as HTMLElement).classList.contains('fab-hidden')).toBe(true);
  });
});
