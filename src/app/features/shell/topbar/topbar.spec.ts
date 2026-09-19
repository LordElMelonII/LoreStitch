import { TestBed } from '@angular/core/testing';
import { DomSanitizer } from '@angular/platform-browser';
import { By } from '@angular/platform-browser';
import { MatDialog } from '@angular/material/dialog';
import { MatIconRegistry } from '@angular/material/icon';
import { MatMenuTrigger } from '@angular/material/menu';
import { of } from 'rxjs';
import {
  CharacterBookEntry,
  ProjectWorkspace,
  createEmptyBook,
  createEmptyEntry,
} from '../../../core/models/lorebook.model';
import { StorageService } from '../../../core/services/storage.service';
import { WorkspaceService } from '../../../core/services/workspace.service';
import { LayoutService } from '../../../shared/services/layout.service';
import { ResponsiveOverlayService } from '../../../shared/services/responsive-overlay.service';
import { LinterDialog } from '../../linter/linter-dialog';
import { ProjectActionsService } from '../project-actions.service';
import { GITHUB_ICON } from '../../../shared/constants/github';
import {
  DESKTOP_BREAKPOINT_QUERY,
  MOBILE_BREAKPOINT_QUERY,
} from '../../../shared/constants/breakpoints';
import { AboutDialog } from '../../about/about-dialog';
import { Topbar } from './topbar';
import { TokenMeter } from './token-meter';

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

describe('Topbar', () => {
  let workspace: WorkspaceService;
  let dialogOpen: ReturnType<typeof vi.fn>;
  let overlayOpen: ReturnType<typeof vi.fn>;
  let desktop: { setDesktop: (matches: boolean) => void; setMobile: (matches: boolean) => void };
  let fixture: import('@angular/core/testing').ComponentFixture<Topbar>;

  /** Builds a workspace holding exactly the given entries (badge/linter tests). */
  function projectOf(entries: CharacterBookEntry[]): ProjectWorkspace {
    return {
      id: 'topbar-project',
      title: 'Topbar',
      createdAt: 1,
      updatedAt: 1,
      targetType: 'standalone_lorebook',
      activeBook: { name: 'Topbar', extensions: {}, entries },
      headCommitId: null,
      commits: [],
    };
  }

  async function createTopbar(): Promise<Topbar> {
    fixture = TestBed.createComponent(Topbar);
    await fixture.whenStable();
    return fixture.componentInstance;
  }

  beforeEach(async () => {
    desktop = installMatchMediaStub();
    dialogOpen = vi.fn().mockReturnValue({ afterClosed: () => of(undefined) });
    overlayOpen = vi.fn();
    await TestBed.configureTestingModule({
      imports: [Topbar],
    }).compileComponents();
    // overrideProvider (not a module-level providers list): the imported
    // Material ng-modules provide the real MatDialog closer to the component,
    // and only overrides win at every injector level.
    TestBed.overrideProvider(MatDialog, { useValue: { open: dialogOpen } });
    // The About pane's viewport branching lives in ResponsiveOverlayService
    // (covered by its own spec); here its opener is stubbed so the top bar's
    // responsibility — the exact call shape — stays the assertion target.
    TestBed.overrideProvider(ResponsiveOverlayService, {
      useValue: { openResponsive: overlayOpen },
    });
    // The top bar renders the inlined GitHub mark; unit tests bypass the app
    // initializer that registers it (see app.spec.ts).
    TestBed.inject(MatIconRegistry).addSvgIconLiteral(
      'github',
      TestBed.inject(DomSanitizer).bypassSecurityTrustHtml(GITHUB_ICON),
    );
    workspace = TestBed.inject(WorkspaceService);
    // Allow the workspace's async init() to settle.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('renders the brand and no-project badge without a project', async () => {
    await createTopbar();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.brand-name')?.textContent).toContain('LoreStitch');
    expect(el.querySelector('.no-project')?.textContent).toContain('No project open');
    // Welcome-screen affordances: GitHub link and theme menu are reachable.
    expect(el.querySelector('[aria-label="GitHub repository"]')).toBeTruthy();
    expect(el.querySelector('[aria-label="Theme menu"]')).toBeTruthy();
    // Project-scoped actions stay hidden.
    expect(el.querySelector('app-token-meter')).toBeNull();
    expect(el.querySelector('[aria-label="New entry"]')).toBeNull();
    expect(el.querySelector('[aria-label="Health check"]')).toBeNull();
  });

  it('shows the project title and project actions with an open project', async () => {
    await workspace.createProject('Fuyuki');
    await createTopbar();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.project-title')?.textContent).toContain('Fuyuki');
    expect(el.querySelector('.no-project')).toBeNull();
    expect(el.querySelector('app-token-meter')).toBeTruthy();
    expect(el.querySelector('[aria-label="New entry"]')).toBeTruthy();
    expect(el.querySelector('[aria-label="Export menu"]')).toBeTruthy();
    // Clean HEAD: no dirty dot, GitHub link moved into the More menu.
    expect(el.querySelector('.unsaved-dot')).toBeNull();
    expect(el.querySelector('[aria-label="GitHub repository"]')).toBeNull();
  });

  it('flags uncommitted changes on the badge and history button', async () => {
    await workspace.createProject('Fuyuki');
    await createTopbar();

    const before = fixture.nativeElement.querySelector('.unsaved-dot');
    expect(before).toBeNull();

    workspace.addEntry();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.unsaved-dot')).toBeTruthy();
    // The warning badge renders the "!" marker on the history icon.
    const badge = fixture.nativeElement
      .querySelector('[aria-label="Toggle history drawer"]')
      ?.querySelector('.mat-badge-content');
    expect(badge?.textContent).toBe('!');
  });

  it('parks the history button for phones, where the bottom bar hosts it', async () => {
    await workspace.createProject('Fuyuki');
    await createTopbar();
    fixture.detectChanges();

    const button = () =>
      fixture.nativeElement.querySelector('[aria-label="Toggle history drawer"]');
    // Desktop keeps the topbar history button...
    expect(button()).toBeTruthy();

    // ...phones get it removed from the DOM entirely (the bottom bar is its
    // home there), so exactly one control carries the label at any width.
    desktop.setMobile(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
    expect(button()).toBeNull();

    desktop.setMobile(false);
    desktop.setDesktop(true);
    // The CDK observer throttles breakpoint emissions.
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
    expect(button()).toBeTruthy();
  });

  it('emits drawer toggles from the menu and history buttons', async () => {
    await workspace.createProject('Fuyuki');
    const topbar = await createTopbar();
    const entriesSpy = vi.fn();
    const historySpy = vi.fn();
    topbar.toggleEntries.subscribe(entriesSpy);
    topbar.toggleHistory.subscribe(historySpy);
    fixture.detectChanges();

    (fixture.nativeElement as HTMLElement)
      .querySelector('[aria-label="Toggle entries panel"]')
      ?.dispatchEvent(new Event('click'));
    (fixture.nativeElement as HTMLElement)
      .querySelector('[aria-label="Toggle history drawer"]')
      ?.dispatchEvent(new Event('click'));

    expect(entriesSpy).toHaveBeenCalledTimes(1);
    expect(historySpy).toHaveBeenCalledTimes(1);
  });

  it('adds an entry from the new-entry button', async () => {
    await workspace.createProject('Fuyuki');
    await createTopbar();
    fixture.detectChanges();

    (fixture.nativeElement as HTMLElement)
      .querySelector('[aria-label="New entry"]')
      ?.dispatchEvent(new Event('click'));

    expect(workspace.entries()).toHaveLength(1);
  });

  it('wires the export menu items to the shared project actions service', async () => {
    await workspace.createProject('Fuyuki');
    await createTopbar();
    // The fixed-format export logic lives on ProjectActionsService (shared
    // with the mobile bottom bar's export menu — covered there and in the
    // service spec); the topbar only wires menu items to it.
    const actions = TestBed.inject(ProjectActionsService);
    const nativeSpy = vi.spyOn(actions, 'exportStNative').mockImplementation(() => undefined);
    const archiveSpy = vi
      .spyOn(actions, 'exportProjectArchive')
      .mockImplementation(() => undefined);
    const bookSpy = vi.spyOn(actions, 'exportBook').mockImplementation(() => undefined);
    const digestSpy = vi.spyOn(actions, 'exportDigest').mockImplementation(() => undefined);

    const clickItem = (title: string): void => {
      const triggerDebug = fixture.debugElement.query(By.css('[aria-label="Export menu"]'));
      assert(triggerDebug);
      triggerDebug.injector.get(MatMenuTrigger).openMenu();
      fixture.detectChanges();
      const item = [...document.querySelectorAll('.mat-mdc-menu-panel button')].find((button) =>
        button.textContent?.includes(title),
      );
      assert(item);
      item.dispatchEvent(new Event('click'));
      fixture.detectChanges();
    };

    clickItem('World Info JSON');
    clickItem('Project archive');
    clickItem('Character Book JSON');
    clickItem('Proofread digest');

    expect(nativeSpy).toHaveBeenCalledTimes(1);
    expect(archiveSpy).toHaveBeenCalledTimes(1);
    expect(bookSpy).toHaveBeenCalledTimes(1);
    expect(digestSpy).toHaveBeenCalledTimes(1);
  });

  it('opens search & replace seeded with the active entry', async () => {
    await workspace.createProject('Fuyuki');
    await createTopbar();
    workspace.addEntry();
    fixture.detectChanges();

    (fixture.nativeElement as HTMLElement)
      .querySelector('[aria-label="Search and replace"]')
      ?.dispatchEvent(new Event('click'));
    // The search dialog is lazy-loaded; the open lands after the import.
    await vi.waitFor(() => expect(dialogOpen).toHaveBeenCalledTimes(1), { timeout: 5000 });
    const call = dialogOpen.mock.calls.at(-1);
    assert(call);
    const options = call[1] as { data: { activeEntryId: number | null } };
    expect(options.data.activeEntryId).toBe(0);
  });

  it('shows the focus toggle only on desktop viewports', async () => {
    await workspace.createProject('Fuyuki');
    await createTopbar();
    // LayoutService classifies a window where no query has answered yet as
    // desktop, so pin an explicit phone viewport before asserting the
    // toggle is hidden below the desktop class.
    desktop.setMobile(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[aria-label="Toggle focus mode"]')).toBeNull();

    desktop.setMobile(false);
    desktop.setDesktop(true);
    // The CDK observer throttles breakpoint emissions (auditTime).
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
    const toggle = fixture.nativeElement.querySelector('[aria-label="Toggle focus mode"]');
    expect(toggle).toBeTruthy();

    // Toggling flips the shared layout state and the pressed marker.
    toggle?.dispatchEvent(new Event('click'));
    fixture.detectChanges();
    const layout = TestBed.inject(LayoutService);
    expect(layout.focusMode()).toBe(true);
    expect(
      fixture.nativeElement
        .querySelector('[aria-label="Toggle focus mode"]')
        ?.getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('collapses the app-level buttons into the More menu on phones with a project', async () => {
    await createTopbar();
    fixture.detectChanges();
    // Welcome screen: no More menu exists, so both stay standalone on every
    // viewport.
    for (const label of ['About LoreStitch', 'Theme menu']) {
      const button = fixture.nativeElement.querySelector(`[aria-label="${label}"]`);
      expect(button).toBeTruthy();
      expect(button?.classList.contains('mobile-hidden')).toBe(false);
    }

    await workspace.createProject('Fuyuki');
    fixture.detectChanges();
    // With a project the More menu exists: phones reach both through it, so
    // the standalone buttons carry the phone-hiding class.
    for (const label of ['About LoreStitch', 'Theme menu']) {
      const button = fixture.nativeElement.querySelector(`[aria-label="${label}"]`);
      expect(button).toBeTruthy();
      expect(button?.classList.contains('mobile-hidden')).toBe(true);
    }
  });

  it('routes the About pane through the responsive overlay', async () => {
    await createTopbar();

    (fixture.nativeElement as HTMLElement)
      .querySelector('[aria-label="About LoreStitch"]')
      ?.dispatchEvent(new Event('click'));
    // The about pane is lazy-loaded; the open lands after the import.
    await vi.waitFor(() => expect(overlayOpen).toHaveBeenCalledTimes(1), { timeout: 5000 });
    const call = overlayOpen.mock.calls.at(-1);
    assert(call);
    const [component, config] = call as [object, Record<string, unknown>];
    // The lazy import resolves to the same class the spec imports statically.
    expect(component).toBe(AboutDialog);
    // Tablet/desktop dialog styling plus the phone sheet panel class; the
    // viewport branching itself belongs to ResponsiveOverlayService.
    expect(config).toEqual({
      dialog: {
        width: '100%',
        maxWidth: 'min(94vw, 680px)',
        panelClass: 'app-about-dialog',
      },
      sheetPanelClass: 'app-about-sheet',
    });
    // The About pane must not bypass the responsive service.
    expect(dialogOpen).not.toHaveBeenCalled();
  });

  it('lists About and a phones-only Theme submenu in the More actions menu', async () => {
    await workspace.createProject('Fuyuki');
    await createTopbar();
    fixture.detectChanges();

    const triggerDebug = fixture.debugElement.query(By.css('[aria-label="More actions menu"]'));
    assert(triggerDebug);
    triggerDebug.injector.get(MatMenuTrigger).openMenu();
    fixture.detectChanges();

    const menuText = document.querySelector('.mat-mdc-menu-panel')?.textContent ?? '';
    expect(menuText).toContain('Health check…');
    expect(menuText).toContain('About LoreStitch…');
    expect(menuText).toContain('Theme');
    // The Theme entry is the phones-only duplicate: on >= 768px the direct
    // button is visible and the entry must disappear (mobile-only class).
    const mobileOnly = document.querySelectorAll('.mat-mdc-menu-panel .mobile-only');
    expect(mobileOnly).toHaveLength(1);
    expect(mobileOnly[0]?.textContent).toContain('Theme');
  });

  it('pins the numeric health-check badge to real issues and hides it at zero', async () => {
    await workspace.createProject('Fuyuki');
    await createTopbar();
    fixture.detectChanges();

    // Clean book: the badge stays hidden, no chrome for a healthy book.
    const healthIcon = () =>
      fixture.nativeElement.querySelector('[aria-label="Health check"] mat-icon');
    expect(healthIcon()?.classList.contains('mat-badge-hidden')).toBe(true);

    // An invalid regex key is one error — the badge shows the count.
    workspace.activeProject.set(projectOf([{ ...createEmptyEntry(0), keys: ['/servant(/'] }]));
    fixture.detectChanges();
    expect(healthIcon()?.classList.contains('mat-badge-hidden')).toBe(false);
    expect(healthIcon()?.querySelector('.mat-badge-content')?.textContent).toBe('1');

    // Info-only findings never light the badge (the entry is keyed so it
    // emits exactly one info diagnostic).
    workspace.activeProject.set(
      projectOf([
        { ...createEmptyEntry(0), keys: ['paris'], selective: true, secondary_keys: [] },
      ]),
    );
    fixture.detectChanges();
    expect(healthIcon()?.classList.contains('mat-badge-hidden')).toBe(true);
  });

  it('mirrors Health check into the More menu, directly after Search & replace', async () => {
    await workspace.createProject('Fuyuki');
    await createTopbar();
    fixture.detectChanges();

    const triggerDebug = fixture.debugElement.query(By.css('[aria-label="More actions menu"]'));
    assert(triggerDebug);
    triggerDebug.injector.get(MatMenuTrigger).openMenu();
    fixture.detectChanges();
    const items = [...document.querySelectorAll('.mat-mdc-menu-panel button')].map(
      (button) => button.textContent ?? '',
    );
    const searchIndex = items.findIndex((text) => text.includes('Search & replace…'));
    const healthIndex = items.findIndex((text) => text.includes('Health check…'));
    assert(searchIndex >= 0);
    assert(healthIndex >= 0);
    // The two authoring-quality tools sit together (plan 03 §3.6.1).
    expect(healthIndex).toBe(searchIndex + 1);
  });

  it('keeps the More-menu Health check item reachable on phones', async () => {
    desktop.setMobile(true);
    await workspace.createProject('Fuyuki');
    await createTopbar();
    fixture.detectChanges();

    // The standalone bar button carries the phone-hiding class (the Search
    // button's exact mechanism — a stylesheet hide, so the node still exists
    // in the jsdom DOM and the class is what the assertion targets)...
    const healthButton = fixture.nativeElement.querySelector('[aria-label="Health check"]');
    expect(healthButton?.classList.contains('desktop-only')).toBe(true);

    // ...and phones reach the pane through the universal More-menu item.
    const triggerDebug = fixture.debugElement.query(By.css('[aria-label="More actions menu"]'));
    assert(triggerDebug);
    triggerDebug.injector.get(MatMenuTrigger).openMenu();
    fixture.detectChanges();
    const menuText = document.querySelector('.mat-mdc-menu-panel')?.textContent ?? '';
    expect(menuText).toContain('Health check…');
  });

  it('opens the health check through the responsive overlay', async () => {
    await workspace.createProject('Fuyuki');
    await createTopbar();
    fixture.detectChanges();

    (fixture.nativeElement as HTMLElement)
      .querySelector('[aria-label="Health check"]')
      ?.dispatchEvent(new Event('click'));
    // The health check pane is lazy-loaded; the open lands after the import.
    await vi.waitFor(() => expect(overlayOpen).toHaveBeenCalledTimes(1), { timeout: 5000 });
    const call = overlayOpen.mock.calls.at(-1);
    assert(call);
    const [component, config] = call as [object, Record<string, unknown>];
    // The lazy import resolves to the same class the spec imports statically.
    expect(component).toBe(LinterDialog);
    // Tablet/desktop dialog styling plus the phone sheet panel class (plan
    // 03 §3.6.1); the viewport branching itself belongs to the overlay service.
    expect(config).toEqual({
      dialog: {
        width: '100%',
        maxWidth: 'min(94vw, 720px)',
        panelClass: 'app-linter-dialog',
        ariaLabel: 'Lorebook health check',
      },
      sheetPanelClass: 'app-linter-sheet',
      sheetConfig: { ariaLabel: 'Lorebook health check' },
    });
    // The health check pane must not bypass the responsive service.
    expect(dialogOpen).not.toHaveBeenCalled();
  });

  it('surfaces the persistence-failure banner while saving is broken', async () => {
    await workspace.createProject('Fuyuki');
    await createTopbar();
    const storage = TestBed.inject(StorageService);
    fixture.detectChanges();
    // jsdom has no IndexedDB: the very first save already fails, which is
    // exactly the condition the banner exists for.
    const banner = fixture.nativeElement.querySelector('.save-error');
    expect(banner).toBeTruthy();
    expect(banner?.getAttribute('aria-label')).toContain('Save failed');

    storage['lastSaveError'].set(null);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.save-error')).toBeNull();

    storage['lastSaveError'].set(new Error('quota exceeded'));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.save-error')).toBeTruthy();
  });
});

describe('TokenMeter', () => {
  let workspace: WorkspaceService;
  let dialogOpen: ReturnType<typeof vi.fn>;

  function projectOf(entries: ProjectWorkspace['activeBook']['entries']): ProjectWorkspace {
    return {
      id: 'meter-project',
      title: 'Meter',
      createdAt: 1,
      updatedAt: 1,
      targetType: 'standalone_lorebook',
      activeBook: { name: 'Meter', extensions: {}, token_budget: 15, entries },
      headCommitId: null,
      commits: [],
    };
  }

  function constantEntry(
    id: number,
    content: string,
  ): ProjectWorkspace['activeBook']['entries'][number] {
    return { ...createEmptyEntry(id), content, constant: true, comment: `C${id}` };
  }

  beforeEach(async () => {
    dialogOpen = vi.fn();
    TestBed.configureTestingModule({
      imports: [TokenMeter],
      providers: [{ provide: MatDialog, useValue: { open: dialogOpen } }],
    });
    workspace = TestBed.inject(WorkspaceService);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('renders nothing while no project is open', async () => {
    const fixture = TestBed.createComponent(TokenMeter);
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('.token-meter')).toBeNull();
  });

  it('shows the always-active footprint of enabled constant entries', async () => {
    workspace.activeProject.set(
      projectOf([
        constantEntry(0, 'a'.repeat(40)), // ~10 tokens
        constantEntry(1, 'b'.repeat(20)), // ~5 tokens
        { ...createEmptyEntry(2), content: 'triggered only', constant: false },
        { ...constantEntry(3, 'c'.repeat(400)), enabled: false }, // disabled: excluded
      ]),
    );
    const fixture = TestBed.createComponent(TokenMeter);
    await fixture.whenStable();
    fixture.detectChanges();

    const meter = fixture.nativeElement.querySelector('.token-meter');
    expect(meter).toBeTruthy();
    expect(meter?.textContent).toContain('~15');

    const tooltip = fixture.componentInstance['tooltip']();
    expect(tooltip).toContain('Always active: ~15 tokens across 2 constant entries');
    expect(tooltip).toContain('of 15 budget (100%)');
    expect(tooltip).not.toContain('over budget');
  });

  it('marks the meter and tooltip when the budget is exceeded', async () => {
    workspace.activeProject.set(
      projectOf([
        constantEntry(0, 'a'.repeat(40)),
        constantEntry(1, 'b'.repeat(40)), // 20 total > 15 budget
      ]),
    );
    const fixture = TestBed.createComponent(TokenMeter);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance['footprint']()?.overBudget).toBe(true);
    expect(fixture.nativeElement.querySelector('.token-meter')?.className).toContain('over-budget');
    expect(fixture.componentInstance['tooltip']()).toContain('over budget');
    expect(fixture.nativeElement.querySelectorAll('.warn-icon').length).toBeGreaterThan(0);
  });

  it('opens the token inspector on click', async () => {
    workspace.activeProject.set(projectOf([constantEntry(0, 'a'.repeat(40))]));
    const fixture = TestBed.createComponent(TokenMeter);
    await fixture.whenStable();
    fixture.detectChanges();

    fixture.nativeElement.querySelector('.token-meter')?.dispatchEvent(new Event('click'));
    // openInspector lazy-loads the inspector dialog module first.
    await vi.waitFor(() => expect(dialogOpen).toHaveBeenCalledTimes(1), { timeout: 5000 });
  });

  it('omits the budget segment when the book has no token_budget', async () => {
    workspace.activeProject.set({
      ...projectOf([]),
      activeBook: { ...createEmptyBook('No budget'), entries: [constantEntry(0, 'a'.repeat(40))] },
    });
    const fixture = TestBed.createComponent(TokenMeter);
    await fixture.whenStable();

    expect(fixture.componentInstance['tooltip']()).toBe(
      'Always active: ~10 tokens across 1 constant entry. Click to inspect.',
    );
  });
});
