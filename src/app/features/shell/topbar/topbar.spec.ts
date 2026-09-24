import { TestBed } from '@angular/core/testing';
import { DomSanitizer } from '@angular/platform-browser';
import { By } from '@angular/platform-browser';
import { MatDialog } from '@angular/material/dialog';
import { MatIconRegistry } from '@angular/material/icon';
import { MatMenuTrigger } from '@angular/material/menu';
import { of } from 'rxjs';
import { createEmptyEntry } from '../../../core/models/lorebook.model';
import { ProjectWorkspace } from '../../../core/models/project.model';
import { StorageService } from '../../../core/services/storage.service';
import { WorkspaceService } from '../../../core/services/workspace.service';
import { LayoutService } from '../../../shared/services/layout.service';
import { ResponsiveOverlayService } from '../../../shared/services/responsive-overlay.service';
import { LinterDialog } from '../../linter/linter-dialog';
import { ProjectActionsService } from '../project-actions.service';
import { GITHUB_ICON } from '../../../shared/constants/github';
import { AboutDialog } from '../../about/about-dialog';
import { Topbar } from './topbar';
import { TokenMeter } from './token-meter';
import { installMatchMediaStub } from '../../../../testing/match-media-stub';
import { projectOf } from '../../../../testing/project-fixtures';

describe('Topbar', () => {
  let workspace: WorkspaceService;
  let dialogOpen: ReturnType<typeof vi.fn>;
  let overlayOpen: ReturnType<typeof vi.fn>;
  let desktop: { setDesktop: (matches: boolean) => void; setMobile: (matches: boolean) => void };
  let fixture: import('@angular/core/testing').ComponentFixture<Topbar>;

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
    const nativeSpy = vi.spyOn(actions, 'exportStNative').mockImplementation(async () => undefined);
    const archiveSpy = vi
      .spyOn(actions, 'exportProjectArchive')
      .mockImplementation(async () => undefined);
    const bookSpy = vi.spyOn(actions, 'exportBook').mockImplementation(async () => undefined);
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

  // ---------------------------------------------------------------------------
  // Character card section (plan 15 §3.5, checkpoint 15-1): availability truth
  // table, the inert-but-hoverable disabled rows and their approved tooltips.
  // ---------------------------------------------------------------------------

  /** Opens the export menu and returns the DOM row carrying `title`. */
  async function openExportMenuAndFind(title: string): Promise<HTMLElement> {
    const triggerDebug = fixture.debugElement.query(By.css('[aria-label="Export menu"]'));
    assert(triggerDebug);
    triggerDebug.injector.get(MatMenuTrigger).openMenu();
    fixture.detectChanges();
    const row = [
      ...document.querySelectorAll<HTMLButtonElement>('.mat-mdc-menu-panel button'),
    ].find((button) => button.textContent?.includes(title));
    assert(row);
    return row;
  }

  it('derives the card export rows from the shell truth table', async () => {
    await createTopbar();
    fixture.detectChanges();
    const rows = () => [
      fixture.componentInstance['cardPngRow'](),
      fixture.componentInstance['cardJsonRow'](),
    ];

    // No project: both unavailable (the menu itself is project-gated).
    expect(rows()).toEqual([
      { ready: false, tooltip: 'Import a character card first' },
      { ready: false, tooltip: 'Import a character card first' },
    ]);

    // JSON-card shell: JSON export ready, PNG still unavailable with its own
    // reason (no image stored).
    workspace.activeProject.set({
      ...projectOf([], { id: 'card-project', title: 'Card' }),
      cardShell: { spec: 'chara_card_v2', cardJson: '{"spec":"chara_card_v2"}' },
    });
    fixture.detectChanges();
    expect(rows()).toEqual([
      { ready: false, tooltip: 'No card image stored — import a card PNG first' },
      { ready: true, tooltip: '' },
    ]);

    // PNG shell: both ready, no tooltips.
    workspace.activeProject.set({
      ...projectOf([], { id: 'card-project' }),
      cardShell: {
        spec: 'chara_card_v2',
        cardJson: '{"spec":"chara_card_v2"}',
        pngKeyword: 'chara',
        pngBytes: Uint8Array.of(0x89, 0x50),
      },
    });
    fixture.detectChanges();
    expect(rows()).toEqual([
      { ready: true, tooltip: '' },
      { ready: true, tooltip: '' },
    ]);
  });

  it('renders the card rows inert-but-hoverable with the approved tooltips', async () => {
    await workspace.createProject('Fuyuki'); // no card shell — both unavailable
    await createTopbar();
    fixture.detectChanges();

    const pngRow = await openExportMenuAndFind('Character card (PNG)');
    const jsonRow = await openExportMenuAndFind('Character card (JSON)');
    // NOT truly disabled: the approved tooltip affordance requires hoverable
    // rows (Material tooltips never fire on disabled buttons).
    expect(pngRow.hasAttribute('disabled')).toBe(false);
    expect(jsonRow.hasAttribute('disabled')).toBe(false);
    // MatMenuItem's own host binding always writes aria-disabled=false, so the
    // unavailable state surfaces through the tooltip directive (visually) and
    // aria-description (the approved copy) for assistive tech.
    expect(pngRow.getAttribute('aria-disabled')).toBe('false');
    expect(pngRow.getAttribute('aria-description')).toBe('Import a character card first');
    expect(jsonRow.getAttribute('aria-description')).toBe('Import a character card first');
    // The muted look comes from the shared class, not a bespoke treatment.
    expect(pngRow.classList.contains('card-export-unavailable')).toBe(true);
    expect(jsonRow.classList.contains('card-export-unavailable')).toBe(true);

    // The section sits at the menu END, after the proofreading items.
    const titles = [...document.querySelectorAll('.mat-mdc-menu-panel .menu-title')].map(
      (el) => el.textContent ?? '',
    );
    expect(titles.indexOf('Proofread digest (Markdown)')).toBeLessThan(
      titles.indexOf('Character card (PNG)'),
    );
    expect(titles[titles.length - 1]).toBe('Character card (JSON)');
    // The wrapper stays wired: an unavailable row still routes its click (the
    // refusal + copy is the wrapper's own contract, pinned in the service spec).
    const actions = TestBed.inject(ProjectActionsService);
    const pngSpy = vi.spyOn(actions, 'exportCardPng').mockImplementation(() => undefined);
    pngRow.dispatchEvent(new Event('click'));
    fixture.detectChanges();
    expect(pngSpy).toHaveBeenCalledTimes(1);
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

  it('pins the More actions menu contents, order and the phones-only Theme entry', async () => {
    await workspace.createProject('Fuyuki');
    await createTopbar();
    fixture.detectChanges();

    const triggerDebug = fixture.debugElement.query(By.css('[aria-label="More actions menu"]'));
    assert(triggerDebug);
    triggerDebug.injector.get(MatMenuTrigger).openMenu();
    fixture.detectChanges();

    // Contents: Health check, About and the Theme submenu are all listed.
    const items = [...document.querySelectorAll('.mat-mdc-menu-panel button')].map(
      (button) => button.textContent ?? '',
    );
    const searchIndex = items.findIndex((text) => text.includes('Search & replace…'));
    const healthIndex = items.findIndex((text) => text.includes('Health check…'));
    assert(searchIndex >= 0);
    assert(healthIndex >= 0);
    // The two authoring-quality tools sit together (plan 03 §3.6.1).
    expect(healthIndex).toBe(searchIndex + 1);
    expect(items.join('\n')).toContain('About LoreStitch…');
    expect(items.join('\n')).toContain('Theme');
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
    workspace.activeProject.set(
      projectOf([{ ...createEmptyEntry(0), keys: ['/servant(/'] }], {
        id: 'topbar-project',
        title: 'Topbar',
      }),
    );
    fixture.detectChanges();
    expect(healthIcon()?.classList.contains('mat-badge-hidden')).toBe(false);
    expect(healthIcon()?.querySelector('.mat-badge-content')?.textContent).toBe('1');

    // Info-only findings never light the badge (the entry is keyed so it
    // emits exactly one info diagnostic).
    workspace.activeProject.set(
      projectOf(
        [{ ...createEmptyEntry(0), keys: ['paris'], selective: true, secondary_keys: [] }],
        { id: 'topbar-project', title: 'Topbar' },
      ),
    );
    fixture.detectChanges();
    expect(healthIcon()?.classList.contains('mat-badge-hidden')).toBe(true);
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

  // The meter's footprint arithmetic, over-budget marking and budget-segment
  // tooltip are pinned by token-estimator.spec and token-inspector-dialog.spec;
  // only the topbar-composition wiring stays here.

  it('opens the token inspector on click', async () => {
    // Two ~10-token constant entries against a 15 budget: the meter renders
    // the footprint and flags the overshoot (the removed dedicated rendering
    // tests used to hold this branch coverage).
    workspace.activeProject.set(
      projectOf([constantEntry(0, 'a'.repeat(40)), constantEntry(1, 'b'.repeat(40))], {
        id: 'meter-project',
        title: 'Meter',
        tokenBudget: 15,
      }),
    );
    const fixture = TestBed.createComponent(TokenMeter);
    await fixture.whenStable();
    fixture.detectChanges();

    const meter = fixture.nativeElement.querySelector('.token-meter');
    expect(meter).toBeTruthy();
    expect(meter?.textContent).toContain('~');
    expect(meter?.className).toContain('over-budget');
    expect(fixture.nativeElement.querySelectorAll('.warn-icon').length).toBeGreaterThan(0);
    expect(fixture.componentInstance['tooltip']()).toContain('over budget');

    // Singular entry without a budget: the tooltip's other wordings.
    workspace.activeProject.set(
      projectOf([constantEntry(0, 'a'.repeat(40))], { id: 'meter-project', title: 'Meter' }),
    );
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.componentInstance['tooltip']()).toBe(
      'Always active: ~10 tokens across 1 constant entry. Click to inspect.',
    );

    meter?.dispatchEvent(new Event('click'));
    // openInspector lazy-loads the inspector dialog module first.
    await vi.waitFor(() => expect(dialogOpen).toHaveBeenCalledTimes(1), { timeout: 5000 });
  });
});
