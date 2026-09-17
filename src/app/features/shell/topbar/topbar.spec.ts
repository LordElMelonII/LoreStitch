import { TestBed } from '@angular/core/testing';
import { DomSanitizer } from '@angular/platform-browser';
import { MatDialog } from '@angular/material/dialog';
import { MatIconRegistry } from '@angular/material/icon';
import { of } from 'rxjs';
import {
  ProjectWorkspace,
  createEmptyBook,
  createEmptyEntry,
} from '../../../core/models/lorebook.model';
import { StorageService } from '../../../core/services/storage.service';
import { ImportExportService } from '../../../core/services/import-export.service';
import { WorkspaceService } from '../../../core/services/workspace.service';
import { LayoutService } from '../../../shared/services/layout.service';
import { GITHUB_ICON } from '../../../shared/constants/github';
import { DESKTOP_BREAKPOINT_QUERY } from '../../../shared/constants/breakpoints';
import { Topbar } from './topbar';
import { TokenMeter } from './token-meter';

/**
 * jsdom has no matchMedia; install a stub whose desktop answer can be flipped
 * mid-test (the CDK observer reacts to change events, exactly like a browser).
 */
function installMatchMediaStub(): { setDesktop: (matches: boolean) => void } {
  let desktopMatches = false;
  const changeListeners = new Set<(event: { matches: boolean }) => void>();
  const fake = (query: string) => ({
    matches: query === DESKTOP_BREAKPOINT_QUERY && desktopMatches,
    media: query,
    onchange: null,
    addListener: (cb: (event: { matches: boolean }) => void) => changeListeners.add(cb),
    removeListener: (cb: unknown) => changeListeners.delete(cb as never),
    addEventListener: (_: string, cb: (event: { matches: boolean }) => void) =>
      changeListeners.add(cb),
    removeEventListener: (_: string, cb: unknown) => changeListeners.delete(cb as never),
    dispatchEvent: () => false,
  });
  Object.defineProperty(window, 'matchMedia', { writable: true, value: fake });
  return {
    setDesktop(matches: boolean) {
      desktopMatches = matches;
      for (const cb of [...changeListeners]) {
        cb({ matches });
      }
    },
  };
}

describe('Topbar', () => {
  let workspace: WorkspaceService;
  let importer: ImportExportService;
  let dialogOpen: ReturnType<typeof vi.fn>;
  let desktop: { setDesktop: (matches: boolean) => void };
  let fixture: import('@angular/core/testing').ComponentFixture<Topbar>;

  async function createTopbar(): Promise<Topbar> {
    fixture = TestBed.createComponent(Topbar);
    await fixture.whenStable();
    return fixture.componentInstance;
  }

  beforeEach(async () => {
    desktop = installMatchMediaStub();
    dialogOpen = vi.fn().mockReturnValue({ afterClosed: () => of(undefined) });
    await TestBed.configureTestingModule({
      imports: [Topbar],
      providers: [{ provide: MatDialog, useValue: { open: dialogOpen } }],
    }).compileComponents();
    // The top bar renders the inlined GitHub mark; unit tests bypass the app
    // initializer that registers it (see app.spec.ts).
    TestBed.inject(MatIconRegistry).addSvgIconLiteral(
      'github',
      TestBed.inject(DomSanitizer).bypassSecurityTrustHtml(GITHUB_ICON),
    );
    workspace = TestBed.inject(WorkspaceService);
    importer = TestBed.inject(ImportExportService);
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

  it('exports the open project in every format through the importer', async () => {
    await workspace.createProject('Fuyuki');
    const topbar = await createTopbar();
    const bookSpy = vi.spyOn(importer, 'exportCharacterBook').mockImplementation(() => undefined);
    const nativeSpy = vi.spyOn(importer, 'exportStNative').mockImplementation(() => undefined);
    const archiveSpy = vi.spyOn(importer, 'exportProject').mockImplementation(() => undefined);
    const digestSpy = vi
      .spyOn(importer, 'exportMarkdownDigest')
      .mockImplementation(() => undefined);
    const project = workspace.activeProject();
    assert(project);

    topbar['exportBook']();
    topbar['exportStNative']();
    topbar['exportProjectArchive']();
    topbar['exportDigest']();

    expect(bookSpy).toHaveBeenCalledWith(project.activeBook, 'Fuyuki');
    expect(nativeSpy).toHaveBeenCalledWith(project.activeBook, 'Fuyuki');
    expect(archiveSpy).toHaveBeenCalledWith(project);
    expect(digestSpy).toHaveBeenCalledWith(project.activeBook, 'Fuyuki');
  });

  it('skips every export without an open project', async () => {
    const topbar = await createTopbar();
    const bookSpy = vi.spyOn(importer, 'exportCharacterBook').mockImplementation(() => undefined);
    const nativeSpy = vi.spyOn(importer, 'exportStNative').mockImplementation(() => undefined);
    const archiveSpy = vi.spyOn(importer, 'exportProject').mockImplementation(() => undefined);
    const digestSpy = vi
      .spyOn(importer, 'exportMarkdownDigest')
      .mockImplementation(() => undefined);

    topbar['exportBook']();
    topbar['exportStNative']();
    topbar['exportProjectArchive']();
    topbar['exportDigest']();

    expect(bookSpy).not.toHaveBeenCalled();
    expect(nativeSpy).not.toHaveBeenCalled();
    expect(archiveSpy).not.toHaveBeenCalled();
    expect(digestSpy).not.toHaveBeenCalled();
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
    const [, options] = dialogOpen.mock.calls[0] as unknown as [
      unknown,
      { data: { activeEntryId: number | null } },
    ];
    expect(options.data.activeEntryId).toBe(0);
  });

  it('shows the focus toggle only on desktop viewports', async () => {
    await workspace.createProject('Fuyuki');
    await createTopbar();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[aria-label="Toggle focus mode"]')).toBeNull();

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

  function constantEntry(id: number, content: string): ProjectWorkspace['activeBook']['entries'][number] {
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
