import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MatMenuTrigger } from '@angular/material/menu';
import { WorkspaceService } from '../../../core/services/workspace.service';
import { ProjectActionsService } from '../project-actions.service';
import { MobileBottomBar, MobileBarAction } from './mobile-bottom-bar';
import { installMatchMediaStub } from '../../../../testing/match-media-stub';

describe('MobileBottomBar', () => {
  let workspace: WorkspaceService;
  let viewport: ReturnType<typeof installMatchMediaStub>;
  let barFixture: ComponentFixture<MobileBottomBar>;

  async function createBar(): Promise<MobileBottomBar> {
    barFixture = TestBed.createComponent(MobileBottomBar);
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

  it('carries no overlay state — full-viewport dialogs cover the docked bar themselves', async () => {
    await workspace.createProject('Fuyuki');
    await resizeToMobile();
    await createBar();

    // CDK overlays sit at the full-viewport plane and dim/block the strip on
    // their own, so the old `overlayOpen` input is gone — no test sets it,
    // and the bar stays mounted and fully interactive underneath whatever
    // the overlay's backdrop does visually. This pin is the evidence: the
    // bar below is in `normal` state by default, with no overlay to answer.
    expect(host().classList.contains('bar-hidden')).toBe(false);
    expect(host().classList.contains('bar-backgrounded')).toBe(false);
    const [firstItem] = itemButtons();
    assert(firstItem);
    expect(firstItem.closest('nav')?.hasAttribute('inert')).toBe(false);
  });

  it('stays stamped and inert while a drawer backgrounds it and returns to normal on close', async () => {
    await workspace.createProject('Fuyuki');
    await resizeToMobile();
    await createBar();
    expect(host().classList.contains('bar-hidden')).toBe(false);

    // A drawer's scrim cannot reach the bar (it lives below the sidenav
    // container), so the shell lowers the bar to `backgrounded` instead of
    // unstamping it: veil class on the host, inert content, host still in
    // flow — the row is never torn down mid-interaction.
    barFixture.componentRef.setInput('barState', 'backgrounded');
    await barFixture.whenStable();
    barFixture.detectChanges();
    const nav = host().querySelector<HTMLElement>('nav.bar');
    assert(nav);
    expect(host().classList.contains('bar-hidden')).toBe(false);
    expect(host().classList.contains('bar-backgrounded')).toBe(true);
    expect(nav.hasAttribute('inert')).toBe(true);

    barFixture.componentRef.setInput('barState', 'normal');
    await barFixture.whenStable();
    barFixture.detectChanges();
    expect(host().classList.contains('bar-backgrounded')).toBe(false);
    expect(nav.hasAttribute('inert')).toBe(false);
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
