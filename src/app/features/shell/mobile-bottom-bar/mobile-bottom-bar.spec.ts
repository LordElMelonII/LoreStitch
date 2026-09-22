import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MatMenuTrigger } from '@angular/material/menu';
import { WorkspaceService } from '../../../core/services/workspace.service';
import { ProjectActionsService } from '../project-actions.service';
import { MobileBottomBar, MobileBarAction, BatchBarAction } from './mobile-bottom-bar';
import { installMatchMediaStub } from '../../../../testing/match-media-stub';
import { projectOf } from '../../../../testing/project-fixtures';

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

  /**
   * Phone bar in the batch state (Task 06 §3.2): the shell flips `barState`
   * and feeds the selection facts it mirrors off `EntryList`'s public API;
   * defaults describe a two-entry selection where not everything shown is
   * selected (the checkbox's mixed tri-state).
   */
  async function createBatchBar(
    selectionFacts: { count?: number; allShown?: boolean; someShown?: boolean } = {},
  ): Promise<MobileBottomBar> {
    await workspace.createProject('Fuyuki');
    await resizeToMobile();
    const bar = await createBar();
    barFixture.componentRef.setInput('barState', 'batch');
    barFixture.componentRef.setInput('selectionCount', selectionFacts.count ?? 2);
    barFixture.componentRef.setInput('allShownSelected', selectionFacts.allShown ?? false);
    barFixture.componentRef.setInput('someShownSelected', selectionFacts.someShown ?? false);
    await barFixture.whenStable();
    barFixture.detectChanges();
    return bar;
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
    expect(exportTrigger.hasAttribute('ng-reflect-app-touch-safe-nested-menu-trigger')).toBe(false);

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

  it('pins the card export rows to the shell availability and approved tooltips', async () => {
    await workspace.createProject('Fuyuki'); // no card shell — both unavailable
    await resizeToMobile();
    await createBar();

    // The same availability rules the topbar rows follow (shared helper).
    expect(barFixture.componentInstance['cardPngRow']()).toEqual({
      ready: false,
      tooltip: 'Import a character card first',
    });
    expect(barFixture.componentInstance['cardJsonRow']()).toEqual({
      ready: false,
      tooltip: 'Import a character card first',
    });

    const triggerDebug = barFixture.debugElement.queryAll(By.css('.bar-item'))[2];
    assert(triggerDebug);
    triggerDebug.injector.get(MatMenuTrigger).openMenu();
    barFixture.detectChanges();

    const row = (title: string): HTMLElement => {
      const found = [
        ...document.querySelectorAll<HTMLButtonElement>('.mat-mdc-menu-panel button'),
      ].find((button) => button.textContent?.includes(title));
      assert(found);
      return found;
    };
    const pngRow = row('Character card (PNG)');
    const jsonRow = row('Character card (JSON)');
    // Inert-but-hoverable: the muted class, never `disabled` (the approved
    // tooltip affordance cannot fire on a disabled button). MatMenuItem's own
    // host binding always writes aria-disabled=false; the copy rides
    // aria-description instead.
    expect(pngRow.hasAttribute('disabled')).toBe(false);
    expect(pngRow.classList.contains('card-export-unavailable')).toBe(true);
    expect(jsonRow.classList.contains('card-export-unavailable')).toBe(true);
    expect(pngRow.getAttribute('aria-description')).toBe('Import a character card first');
    expect(pngRow.getAttribute('aria-disabled')).toBe('false');

    // A JSON-card shell enables the JSON row only.
    workspace.activeProject.set({
      ...projectOf([], { id: 'card-project', title: 'Card' }),
      cardShell: { spec: 'chara_card_v2', cardJson: '{"spec":"chara_card_v2"}' },
    });
    barFixture.detectChanges();
    expect(barFixture.componentInstance['cardJsonRow']()).toEqual({ ready: true, tooltip: '' });
    expect(barFixture.componentInstance['cardPngRow']().tooltip).toBe(
      'No card image stored — import a card PNG first',
    );
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

  // -------------------------------------------------------------------------
  // Batch swap (Task 06 §3.2): while the entries drawer holds a selection the
  // shell flips `barState` to `batch` and the five quick items give way to
  // the entry-list batch toolbar, transplanted into the strip (variant A2).
  // -------------------------------------------------------------------------

  it('swaps the five quick actions for the five batch action items in batch state', async () => {
    await createBatchBar();

    // The swap is exclusive: no quick-action nav, no veil class.
    expect(host().querySelector('nav.bar')).toBeNull();
    expect(itemButtons()).toHaveLength(5);
    expect(host().classList.contains('bar-backgrounded')).toBe(false);

    // The toolbar keeps the `.batch-bar` DOM contract (role/label/classes) so
    // the shared e2e helper (`getByRole('toolbar', { name: 'Batch actions' })`)
    // and the `.batch-bar button` touch-target selectors keep working.
    const toolbar = host().querySelector('.batch-bar');
    assert(toolbar);
    expect(toolbar.getAttribute('role')).toBe('toolbar');
    expect(toolbar.getAttribute('aria-label')).toBe('Batch actions');
    expect(toolbar.querySelector('.batch-count')?.textContent).toContain('2 selected');
    expect(toolbar.querySelectorAll('button').length).toBe(5);
    expect(toolbar.querySelector('.select-all')).toBeTruthy();

    // Leaving batch brings the five items back — and the veil with them.
    barFixture.componentRef.setInput('barState', 'backgrounded');
    await barFixture.whenStable();
    barFixture.detectChanges();
    expect(host().querySelector('.batch-bar')).toBeNull();
    expect(itemButtons()).toHaveLength(5);
    expect(host().classList.contains('bar-backgrounded')).toBe(true);
  });

  it('wires the select-all button tri-state from the shell-passed selection facts', async () => {
    await createBatchBar({ count: 2, someShown: true });
    const button = host().querySelector<HTMLButtonElement>('.select-all');
    assert(button);
    // Mixed tri-state: some shown entries selected but not all.
    expect(button.getAttribute('role')).toBe('checkbox');
    expect(button.getAttribute('aria-checked')).toBe('mixed');
    expect(button.querySelector('mat-icon')?.textContent?.trim()).toBe('indeterminate_check_box');

    // The shell mirrors `EntryList.allFilteredSelected`/`someFilteredSelected`
    // into these inputs; the button follows them one-way.
    barFixture.componentRef.setInput('allShownSelected', true);
    barFixture.componentRef.setInput('someShownSelected', false);
    await barFixture.whenStable();
    barFixture.detectChanges();
    expect(button.getAttribute('aria-checked')).toBe('true');
    expect(button.querySelector('mat-icon')?.textContent?.trim()).toBe('check_box');

    barFixture.componentRef.setInput('allShownSelected', false);
    barFixture.componentRef.setInput('someShownSelected', false);
    await barFixture.whenStable();
    barFixture.detectChanges();
    expect(button.getAttribute('aria-checked')).toBe('false');
    expect(button.querySelector('mat-icon')?.textContent?.trim()).toBe('check_box_outline_blank');
  });

  it('emits the batch actions from the toolbar buttons', async () => {
    const bar = await createBatchBar();
    const emitted: BatchBarAction[] = [];
    bar.batchAction.subscribe((action) => emitted.push(action));

    const click = (label: string) =>
      host().querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)?.click();
    click('Batch edit selection');
    click('Export selection as lorebook');
    // more_vert is deliberately absent: it opens the batch menu in place and
    // never emits (`more-batch-actions` is a shell-side no-op by contract).
    click('Clear selection');
    barFixture.detectChanges();

    expect(emitted).toEqual(['batch-edit', 'export-selected', 'clear-selection']);
  });

  it('emits select-all-shown from the select-all button on either toggle side', async () => {
    const bar = await createBatchBar();
    const emitted: BatchBarAction[] = [];
    bar.batchAction.subscribe((action) => emitted.push(action));

    // The button only emits the bare member; the shell resolves the
    // boolean against the public tri-state facts it owns (documented
    // contract). Both toggle sides must emit the same member.
    const button = host().querySelector<HTMLButtonElement>('.select-all');
    assert(button);
    button.click(); // unchecked → checked side
    barFixture.detectChanges();
    expect(emitted).toEqual(['select-all-shown']);

    button.click(); // checked → unchecked side (deselect-shown intent)
    barFixture.detectChanges();
    expect(emitted).toEqual(['select-all-shown', 'select-all-shown']);
  });

  it('offers the select-all leaf above the legacy leaves and disables it when everything shown is selected', async () => {
    const bar = await createBatchBar({ allShown: true });
    const emitted: BatchBarAction[] = [];
    bar.batchAction.subscribe((action) => emitted.push(action));
    const triggerDebug = barFixture.debugElement.query(By.css('[aria-label="More batch actions"]'));
    assert(triggerDebug);
    triggerDebug.injector.get(MatMenuTrigger).openMenu();
    barFixture.detectChanges();

    const leaves = [...document.querySelectorAll<HTMLButtonElement>('.mat-mdc-menu-panel button')];
    const labels = leaves.map((leaf) => leaf.querySelector('span')?.textContent?.trim());
    expect(labels).toEqual([
      'Select all shown entries',
      'Duplicate selected',
      'Enable selected',
      'Disable selected',
      'Delete selected…',
    ]);

    // Mirrors the checkbox tri-state: disabled when everything shown is
    // already selected — and a disabled leaf can no longer emit.
    const selectAllLeaf = leaves[0];
    assert(selectAllLeaf);
    expect(selectAllLeaf.disabled).toBe(true);
    selectAllLeaf.click();
    barFixture.detectChanges();
    expect(emitted).toEqual([]);

    // Everything-not-selected re-enables it (the menu re-renders on open).
    barFixture.componentRef.setInput('allShownSelected', false);
    await barFixture.whenStable();
    barFixture.detectChanges();
    triggerDebug.injector.get(MatMenuTrigger).openMenu();
    barFixture.detectChanges();
    const reopened = document.querySelector<HTMLButtonElement>('.mat-mdc-menu-panel button');
    assert(reopened);
    expect(reopened.querySelector('span')?.textContent?.trim()).toBe('Select all shown entries');
    expect(reopened.disabled).toBe(false);
  });

  it('emits the batch menu leaves through the shell channel', async () => {
    const bar = await createBatchBar();
    const emitted: BatchBarAction[] = [];
    bar.batchAction.subscribe((action) => emitted.push(action));

    const triggerDebug = barFixture.debugElement.query(By.css('[aria-label="More batch actions"]'));
    assert(triggerDebug);
    triggerDebug.injector.get(MatMenuTrigger).openMenu();
    barFixture.detectChanges();

    const leaves = [...document.querySelectorAll<HTMLButtonElement>('.mat-mdc-menu-panel button')];
    expect(leaves).toHaveLength(5);
    for (const leaf of leaves) {
      leaf.dispatchEvent(new Event('click'));
    }
    barFixture.detectChanges();

    expect(emitted).toEqual([
      'select-all-shown',
      'duplicate-selection',
      'enable-selection',
      'disable-selection',
      'delete-selection',
    ]);
  });

  it('keeps the batch state foreground: no veil, no inert, and the A2 tonal edge only in batch', async () => {
    await createBatchBar();
    // Foreground: no scrim veil, no inert content (the toolbar branch is
    // fully interactive while the drawer is open), and the approved A2
    // emphasis — the tonal top edge — carried by the host class.
    expect(host().classList.contains('bar-batch')).toBe(true);
    expect(host().classList.contains('bar-backgrounded')).toBe(false);

    barFixture.componentRef.setInput('barState', 'backgrounded');
    await barFixture.whenStable();
    barFixture.detectChanges();
    expect(host().classList.contains('bar-batch')).toBe(false);
    expect(host().classList.contains('bar-backgrounded')).toBe(true);

    barFixture.componentRef.setInput('barState', 'normal');
    await barFixture.whenStable();
    barFixture.detectChanges();
    expect(host().classList.contains('bar-batch')).toBe(false);
    expect(host().classList.contains('bar-backgrounded')).toBe(false);
  });
});
