import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { DebugElement } from '@angular/core';
import { By } from '@angular/platform-browser';
import { CdkVirtualForOf } from '@angular/cdk/scrolling';
import { MatDialog } from '@angular/material/dialog';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of } from 'rxjs';
import { CharacterBookEntry, createEmptyEntry } from '../../core/models/lorebook.model';
import { WorkspaceService } from '../../core/services/workspace.service';
import { ProjectActionsService } from '../shell/project-actions.service';
import { ResponsiveOverlayService } from '../../shared/services/responsive-overlay.service';
import { SEARCH_DEBOUNCE_MS } from '../../shared/constants/search';
import { installMatchMediaStub } from '../../../testing/match-media-stub';
import { EntryList, LONG_PRESS_MS } from './entry-list';
import { BatchOperationsDialog } from './batch-operations-dialog';
import { ConfirmDialog } from '../../shared/components/confirm-dialog/confirm-dialog';
import { DelimiterDialog } from '../delimiters/delimiter-dialog';
import { entryWith as entry, projectOf } from '../../../testing/project-fixtures';

/** Seeds a list workspace; most tests use the default project id. */
function seededProject(entries: CharacterBookEntry[], id = 'test-project') {
  return projectOf(entries, { id });
}

describe('EntryList', () => {
  let workspace: WorkspaceService;
  let actions: ProjectActionsService;
  let snackBar: MatSnackBar;
  let dialogOpen: ReturnType<typeof vi.fn>;
  let openResponsive: ReturnType<typeof vi.fn>;
  let viewport: ReturnType<typeof installMatchMediaStub>;
  let fixture: ComponentFixture<EntryList>;

  async function createList(
    entries: CharacterBookEntry[] = [],
    projectId = 'test-project',
  ): Promise<EntryList> {
    workspace.activeProject.set(seededProject(entries, projectId));
    fixture = TestBed.createComponent(EntryList);
    await fixture.whenStable();
    return fixture.componentInstance;
  }

  /** The i-th visible row, asserted (rows are indexed directly in these specs). */
  function itemAt(list: EntryList, index: number) {
    const item = list['items']()[index];
    assert(item);
    return item;
  }

  /** Flushes component effects after direct signal mutations. */
  async function settle(): Promise<void> {
    await fixture.whenStable();
  }

  /**
   * Settles the debounced filter. `detectChanges()` flushes the component's
   * debounce-arming view effect synchronously — Angular schedules view-effect
   * flushes on its own setTimeout/rAF race, which fake-time advances cannot be
   * relied upon to fire — and the subsequent full-window advance then fires
   * the trailing edge (storage.service.spec's canonical advance pattern).
   */
  async function settleFilter(): Promise<void> {
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
  }

  /**
   * The i-th rendered row checkbox, in view order. The test viewport keeps
   * small books (and small filtered views) fully rendered — keep DOM-driven
   * specs within the rendered window.
   */
  function checkboxAt(index: number): DebugElement {
    const checkbox = fixture.debugElement.queryAll(By.css('.row-select'))[index];
    assert(checkbox);
    return checkbox;
  }

  /** The native input Material renders inside a row checkbox. */
  function checkboxInput(checkbox: DebugElement): HTMLInputElement {
    const input: HTMLInputElement | null = checkbox.nativeElement.querySelector('input');
    assert(input);
    return input;
  }

  /**
   * Dispatches a pointer event on a row checkbox. The handlers only read
   * `pointerType`/`clientX`/`clientY` (plan 20 D4's dispatch contract); the
   * test env's PointerEvent carries them natively.
   */
  function pointer(checkbox: DebugElement, type: string, init: PointerEventInit = {}): void {
    checkbox.nativeElement.dispatchEvent(
      new PointerEvent(type, { bubbles: true, cancelable: true, ...init }),
    );
  }

  /** Shift+click dispatched at a row checkbox's input, as a browser hits it. */
  function shiftClick(checkbox: DebugElement): MouseEvent {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true });
    checkboxInput(checkbox).dispatchEvent(event);
    return event;
  }

  beforeEach(async () => {
    // The debounced filter settles on fake time (storage.service.spec
    // precedent) so specs can pin the lag explicitly and flush it cheaply.
    // Only the timer pair debouncedSignal uses is faked: the default set
    // also fakes microtask/rAF scheduling, which starves
    // fixture.whenStable() and hangs every component spec (an interval-based
    // faked clock would too — so the viewport flips below settle on real
    // timers instead; see the test).
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    // The shell's viewport truth (LayoutService over CDK BreakpointObserver,
    // read by this component and ProjectActionsService) needs matchMedia;
    // the stub's desktop/mobile answers can be flipped mid-test — the
    // toolbar-presence pins exercise both window classes.
    viewport = installMatchMediaStub();
    dialogOpen = vi.fn().mockReturnValue({ afterClosed: () => of(true) });
    // The batch pane opens through the responsive overlay (dialog or sheet);
    // the plain-object ref makes the caller take its afterDismissed branch.
    openResponsive = vi.fn().mockReturnValue({ afterDismissed: () => of(true) });
    await TestBed.configureTestingModule({
      imports: [EntryList],
      providers: [
        { provide: MatDialog, useValue: { open: dialogOpen } },
        { provide: ResponsiveOverlayService, useValue: { openResponsive } },
      ],
    }).compileComponents();
    workspace = TestBed.inject(WorkspaceService);
    actions = TestBed.inject(ProjectActionsService);
    snackBar = TestBed.inject(MatSnackBar);
    vi.spyOn(snackBar, 'open');
    // Allow the workspace's async init() to settle before the component reads it.
    await vi.advanceTimersByTimeAsync(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('lists every entry with title, keys and token estimate', async () => {
    const list = await createList([
      entry(0, { comment: 'Saber', keys: ['saber', 'artoria'], content: 'King of Knights.' }),
      entry(1, { comment: 'Rin', keys: ['rin'] }),
    ]);

    const items = list['items']();
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ id: 0, title: 'Saber', keys: ['saber', 'artoria'] });
    assert(items[0]);
    expect(items[0].tokens).toBeGreaterThan(0);
    // The search haystack folds once per entry change: title, keys, tags and
    // content joined on '\n', lowercased — the filter only `includes` over it.
    expect(items[0].search).toBe('saber\nsaber\nartoria\nking of knights.');
  });

  it('tracks the virtual rows by entry id (plan 18 D6)', async () => {
    const list = await createList([
      entry(0, { comment: 'Saber', keys: ['saber'] }),
      entry(1, { comment: 'Rin', keys: ['rin'] }),
    ]);

    // The *cdkVirtualFor microsyntax's `trackBy: trackById` reaches the
    // directive as `cdkVirtualForTrackBy`; CDK wraps it with a rendered-range
    // offset but passes the return value through. templateCacheSize stays 0
    // deliberately, so this track fn is what carries row reuse across a
    // book-wide mutation.
    // The structural directive hosts on a comment anchor — invisible to
    // `By.directive` (elements only), so resolve it from the debug-node tree.
    const hosts = fixture.debugElement.queryAllNodes(
      (node) => node.injector.get(CdkVirtualForOf, null) !== null,
    );
    assert(hosts.length > 0);
    const host = hosts[0];
    assert(host);
    const forOf = host.injector.get(CdkVirtualForOf);
    const track = forOf.cdkVirtualForTrackBy;
    assert(track);
    const item = itemAt(list, 1);
    assert(item);
    expect(track(0, item)).toBe(1);

    // The bound function itself is a pure id projection (index unused).
    expect(list['trackById'](3, item)).toBe(1);
  });

  it('shows the empty state on an empty book', async () => {
    const list = await createList([]);
    fixture.detectChanges();

    const empty = fixture.nativeElement.querySelector('.empty-state');
    expect(empty?.textContent).toContain('This lorebook is empty');
    expect(list['filtered']()).toHaveLength(0);
  });

  it('filters by title, keys, tags and content, case-insensitively', async () => {
    const list = await createList([
      entry(0, { comment: 'Saber', keys: ['artoria'], content: 'King of Knights.' }),
      entry(1, { comment: 'Rin', keys: ['tohsaka'], content: 'Jewel magecraft.' }),
      entry(2, {
        comment: 'Shielder',
        keys: ['mash'],
        content: 'A member of the round table.',
        // Tag "round-table" only on entry 2: the text query must hit tags too.
        extensions: { ...createEmptyEntry(2).extensions, lorestitch_tags: ['round-table'] },
      }),
    ]);
    // Multi-word, mixed-case: 'ROUND TABLE' hits entry 2's content.
    list['filterModel'].set({ query: 'ROUND TABLE' });
    await settleFilter();
    expect(list['filtered']().map((i) => i.id)).toEqual([2]);

    list['filterModel'].set({ query: 'saber' });
    await settleFilter();
    expect(list['filtered']().map((i) => i.id)).toEqual([0]);

    list['filterModel'].set({ query: 'tohsaka' });
    await settleFilter();
    expect(list['filtered']().map((i) => i.id)).toEqual([1]);

    list['filterModel'].set({ query: 'magecraft' });
    await settleFilter();
    expect(list['filtered']().map((i) => i.id)).toEqual([1]);

    // Author tags are part of the pre-folded haystack.
    list['filterModel'].set({ query: 'round-table' });
    await settleFilter();
    expect(list['filtered']().map((i) => i.id)).toEqual([2]);

    list['filterModel'].set({ query: '  ' });
    await settleFilter();
    expect(list['filtered']()).toHaveLength(3);
  });

  it('debounces the scan: the list settles only after the debounce window', async () => {
    const list = await createList([entry(0, { comment: 'Saber' }), entry(1, { comment: 'Rin' })]);

    list['filterModel'].set({ query: 'saber' });
    // Flush the component so the debounce timer is armed, without settling it.
    fixture.detectChanges();
    // The input's value is immediate; the scanned list is not.
    expect(list['filter']()).toBe('saber');
    expect(list['filterDebounced']()).toBe('');
    expect(list['filtered']()).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS - 1);
    expect(list['filtered']()).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(1);
    expect(list['filterDebounced']()).toBe('saber');
    expect(list['filtered']().map((i) => i.id)).toEqual([0]);
  });

  it('matches multi-word queries within one field, never across field boundaries', async () => {
    const list = await createList([
      entry(0, { comment: 'Saber', keys: ['artoria'], content: 'King of Knights.' }),
      entry(1, { comment: 'Rin', keys: ['rin'], content: 'Jewel magecraft.' }),
    ]);

    // Both words sit inside entry 1's content: the phrase matches.
    list['filterModel'].set({ query: 'jewel magecraft' });
    await settleFilter();
    expect(list['filtered']().map((i) => i.id)).toEqual([1]);

    // The same words split across entry 0's title and key do NOT join into a
    // match: the haystack's '\n' separators keep fields from concatenating,
    // so a query can only ever match inside a single field.
    list['filterModel'].set({ query: 'saber artoria' });
    await settleFilter();
    expect(list['filtered']()).toHaveLength(0);
  });

  it('clears the filter from the clear button in the header', async () => {
    const list = await createList([entry(0, { comment: 'Saber' })]);
    list['filterModel'].set({ query: 'saber' });
    fixture.detectChanges();
    expect(list['filter']()).toBe('saber');

    const button = fixture.debugElement.query(By.css('[aria-label="Clear filter"]'));
    expect(button).toBeTruthy();
    button.nativeElement.click();
    await settle();

    expect(list['filter']()).toBe('');
  });

  it('collects tags alphabetically and AND-combines tag filters', async () => {
    const list = await createList([
      entry(0, {
        comment: 'Saber',
        extensions: { ...createEmptyEntry(0).extensions, lorestitch_tags: ['servant', 'saber'] },
      }),
      entry(1, {
        comment: 'Rin',
        extensions: { ...createEmptyEntry(1).extensions, lorestitch_tags: ['master', 'servant'] },
      }),
      entry(2, { comment: 'Grail', extensions: { lorestitch_tags: ['artifact'] } }),
    ]);

    expect(list['allTags']()).toEqual(['artifact', 'master', 'saber', 'servant']);

    list['toggleTagFilter']('servant');
    expect(list['filtered']().map((i) => i.id)).toEqual([0, 1]);
    expect(list['isTagActive']('servant')).toBe(true);

    // Both tags must be carried by the same entry (AND semantics).
    list['toggleTagFilter']('master');
    expect(list['filtered']().map((i) => i.id)).toEqual([1]);

    list['toggleTagFilter']('master');
    expect(list['isTagActive']('master')).toBe(false);
    expect(list['filtered']().map((i) => i.id)).toEqual([0, 1]);
  });

  it('toggles a row selection on and off', async () => {
    const list = await createList([entry(0), entry(1)]);

    list['toggleRow'](itemAt(list, 0), true);
    expect(list['selection']()).toEqual(new Set([0]));

    list['toggleRow'](itemAt(list, 0), false);
    expect(list['selection']()).toEqual(new Set());
  });

  it('select-all covers only filtered entries; unchecking keeps hidden selections', async () => {
    const list = await createList([entry(0, { comment: 'Saber' }), entry(1, { comment: 'Rin' })]);
    list['filterModel'].set({ query: 'saber' });
    await settleFilter();

    // `selectAllShown` is the public wrapper the bar's swap drives (Task 06
    // §3.3); its semantics are the header checkbox's toggleSelectAll.
    list.selectAllShown(true);
    expect(list['selection']()).toEqual(new Set([0]));
    expect(list.allFilteredSelected()).toBe(true);

    // Add a hidden entry to the selection, then uncheck select-all: only the
    // shown entry is deselected, the hidden one stays selected.
    list['toggleRow'](itemAt(list, 1), true);
    expect(list.allFilteredSelected()).toBe(true);
    list.selectAllShown(false);
    expect(list['selection']()).toEqual(new Set([1]));

    // Partial coverage of the shown view reads as indeterminate.
    list['filterModel'].set({ query: '' });
    await settleFilter();
    expect(list.someFilteredSelected()).toBe(true);

    list.clearSelection();
    expect(list['selection']().size).toBe(0);
  });

  it('renders the batch bar once something is selected', async () => {
    await createList([entry(0), entry(1)]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.batch-bar')).toBeNull();

    const list = fixture.componentInstance;
    list['toggleRow'](itemAt(list, 0), true);
    await settle();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.batch-bar')).toBeTruthy();
    // The count rides the select-all's badge and accessible name (user
    // decision 2026-09-26 — the labeled span never fit six actions).
    const selectAll = fixture.nativeElement.querySelector('.select-all');
    expect(selectAll?.getAttribute('aria-label')).toContain('1 selected');
    expect(selectAll?.querySelector('.mat-badge-content')?.textContent).toContain('1');
    expect(selectAll?.getAttribute('aria-checked')).toBe('mixed');
  });

  it('hides the in-drawer batch toolbar on phones — the docked bottom bar owns it there', async () => {
    await createList([entry(0), entry(1)]);
    const list = fixture.componentInstance;
    list.selectAllShown(true);
    fixture.detectChanges();
    // Desktop default: the inline header toolbar, exactly as today (§3.5).
    expect(fixture.nativeElement.querySelector('.batch-bar')).toBeTruthy();
    expect(list.selectionCount()).toBe(2);

    // Phones: the toolbar disappears (Task 06 §3.2/§3.3) — the batch
    // actions render in the docked bottom bar's swap instead, removing the
    // row shift and the clipped ✕ (defects 2 + 3). The selection itself
    // survives the viewport flip untouched.
    // The flip rides CDK's BreakpointObserver, whose debounced re-emit lives
    // on RxJS's interval-backed asyncScheduler — a real-event-loop timer the
    // fake setTimeout clock above never controls, and faking intervals here
    // would hang every await. So the window around each flip runs on real
    // timers and waits the debounce out, the same settle the topbar spec
    // uses for its own flip pin.
    vi.useRealTimers();
    viewport.setMobile(true);
    await new Promise((resolve) => setTimeout(resolve, 10));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.batch-bar')).toBeNull();
    expect(list.selectionCount()).toBe(2);
    expect(list.allFilteredSelected()).toBe(true);

    // Back on desktop the toolbar returns with the same selection.
    viewport.setMobile(false);
    await new Promise((resolve) => setTimeout(resolve, 10));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.batch-bar')).toBeTruthy();
  });

  it('renders the drawer close button on the mobile band only (task 21 D2)', async () => {
    await createList([entry(0)]);
    fixture.detectChanges();

    // Desktop default: absent from the DOM — the responsive-shape contract
    // removes it (@if), never display:none.
    const selector = '[aria-label="Close entries panel"]';
    expect(fixture.nativeElement.querySelector(selector)).toBeNull();

    // Phones get it: the full-width overlay drawer has no scrim sliver left
    // to tap, so the close affordance lives in the pane's header. The flip
    // rides CDK's debounced re-emit on a real-timer scheduler (see the
    // batch-toolbar flip test above).
    vi.useRealTimers();
    viewport.setMobile(true);
    await new Promise((resolve) => setTimeout(resolve, 10));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector(selector)).toBeTruthy();

    // Back on desktop the button is removed again.
    viewport.setMobile(false);
    await new Promise((resolve) => setTimeout(resolve, 10));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector(selector)).toBeNull();
  });

  it('emits closeDrawer when the header close button is clicked on the mobile band', async () => {
    await createList([entry(0)]);
    fixture.detectChanges();

    vi.useRealTimers();
    viewport.setMobile(true);
    await new Promise((resolve) => setTimeout(resolve, 10));
    fixture.detectChanges();

    const button = fixture.debugElement.query(By.css('[aria-label="Close entries panel"]'));
    assert(button);
    let closed = 0;
    fixture.componentInstance.closeDrawer.subscribe(() => closed++);
    button.nativeElement.click();
    await settle();

    expect(closed).toBe(1);
  });

  it('prunes selected ids that no longer exist (rollback / batch delete)', async () => {
    const list = await createList([entry(0), entry(1), entry(2)]);
    list['toggleRow'](itemAt(list, 0), true);
    list['toggleRow'](itemAt(list, 1), true);

    workspace.deleteEntries([1]);
    await settle();

    expect(list['selection']()).toEqual(new Set([0]));
  });

  it('drops selection and tag filter when the project changes', async () => {
    const list = await createList([entry(0), entry(1)]);
    list['toggleRow'](itemAt(list, 0), true);
    list['toggleTagFilter']('servant');

    workspace.activeProject.set(seededProject([entry(0)], 'other-project'));
    await settle();

    expect(list['selection']().size).toBe(0);
    expect(list['tagFilter']().size).toBe(0);
  });

  it('duplicates the selection with a snackbar and no-ops on empty selection', async () => {
    const duplicateSpy = vi.spyOn(workspace, 'duplicateEntries');
    const list = await createList([entry(0), entry(1)]);

    list.duplicateSelection();
    expect(duplicateSpy).not.toHaveBeenCalled();

    list['toggleRow'](itemAt(list, 1), true);
    list.duplicateSelection();
    expect(duplicateSpy).toHaveBeenCalledWith([1]);
    expect(snackBar.open).toHaveBeenCalledWith('Duplicated 1 entry.', 'OK', { duration: 3000 });
  });

  it('enables and disables the selection through updateManyEntries', async () => {
    const list = await createList([entry(0), entry(1)]);
    list['toggleRow'](itemAt(list, 0), true);
    list['toggleRow'](itemAt(list, 1), true);

    list.setSelectionEnabled(false);
    expect(workspace.entries().every((e) => !e.enabled)).toBe(true);
    expect(snackBar.open).toHaveBeenCalledWith('Disabled 2 entries.', 'OK', { duration: 3000 });

    list.setSelectionEnabled(true);
    expect(workspace.entries().every((e) => e.enabled)).toBe(true);
    expect(snackBar.open).toHaveBeenCalledWith('Enabled 2 entries.', 'OK', { duration: 3000 });
  });

  it('deletes the selection after confirmation and clears it', async () => {
    const deleteSpy = vi.spyOn(workspace, 'deleteEntries').mockImplementation(() => undefined);
    const list = await createList([entry(0), entry(1)]);
    list['toggleRow'](itemAt(list, 0), true);
    list['toggleRow'](itemAt(list, 1), true);

    await list.deleteSelection();

    expect(dialogOpen).toHaveBeenCalledTimes(1);
    expect(deleteSpy).toHaveBeenCalledWith([0, 1]);
    expect(list['selection']().size).toBe(0);
    expect(snackBar.open).toHaveBeenCalledWith('Deleted 2 entries.', 'OK', { duration: 3000 });
  });

  it('keeps the selection when the delete confirmation is dismissed', async () => {
    dialogOpen.mockReturnValue({ afterClosed: () => of(undefined) });
    const deleteSpy = vi.spyOn(workspace, 'deleteEntries');
    const list = await createList([entry(0)]);
    list['toggleRow'](itemAt(list, 0), true);

    await list.deleteSelection();

    expect(dialogOpen).toHaveBeenCalledTimes(1);
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(list['selection']()).toEqual(new Set([0]));
  });

  it('opens batch operations through the responsive overlay and clears the selection when applied', async () => {
    const list = await createList([entry(0), entry(1)]);
    list['toggleRow'](itemAt(list, 0), true);

    await list.openBatchOperations();

    expect(openResponsive).toHaveBeenCalledTimes(1);
    const [component, config] = openResponsive.mock.calls[0] as unknown as [
      unknown,
      {
        data: { entryIds: number[] };
        dialog: Record<string, string>;
        sheetPanelClass: string;
        sheetConfig: { ariaLabel: string };
      },
    ];
    expect(component).toBe(BatchOperationsDialog);
    expect(config.data).toEqual({ entryIds: [0] });
    // The tablet/desktop dialog config is unchanged from the direct
    // dialog.open() era; the sheet variant is registered alongside it.
    expect(config.dialog).toEqual({
      width: '100%',
      maxWidth: 'min(96vw, 560px)',
      panelClass: 'app-compact-fullscreen-dialog',
    });
    expect(config.sheetPanelClass).toBe('app-batch-sheet');
    expect(config.sheetConfig).toEqual({ ariaLabel: 'Batch edit entries' });
    expect(list['selection']().size).toBe(0);
  });

  it('keeps the selection when batch operations are cancelled', async () => {
    openResponsive.mockReturnValue({ afterDismissed: () => of(false) });
    const list = await createList([entry(0)]);
    list['toggleRow'](itemAt(list, 0), true);

    await list.openBatchOperations();

    expect(list['selection']()).toEqual(new Set([0]));
  });

  it('opens the delimiter pane over the selection and clears it when applied', async () => {
    const list = await createList([entry(0), entry(1)]);
    list['toggleRow'](itemAt(list, 0), true);
    list['toggleRow'](itemAt(list, 1), true);

    await list.openDelimiters();

    expect(openResponsive).toHaveBeenCalledTimes(1);
    const [component, config] = openResponsive.mock.calls[0] as unknown as [
      unknown,
      {
        data: { entryIds: number[] };
        dialog: Record<string, string>;
        sheetPanelClass: string;
        sheetConfig: { ariaLabel: string };
      },
    ];
    expect(component).toBe(DelimiterDialog);
    // The pane is locked to the checked selection (Task 12 §5.2, D2).
    expect(config.data).toEqual({ entryIds: [0, 1] });
    expect(config.dialog).toEqual({
      maxWidth: 'min(96vw, 860px)',
      panelClass: 'app-compact-fullscreen-dialog',
    });
    expect(config.sheetPanelClass).toBe('app-delimiters-sheet');
    expect(config.sheetConfig).toEqual({ ariaLabel: 'Content delimiters' });
    // Batch-edit precedent: the selection survives only a truthy close.
    expect(list['selection']().size).toBe(0);
  });

  it('keeps the selection when the delimiter pane is cancelled', async () => {
    openResponsive.mockReturnValue({ afterDismissed: () => of(false) });
    const list = await createList([entry(0)]);
    list['toggleRow'](itemAt(list, 0), true);

    await list.openDelimiters();

    expect(list['selection']()).toEqual(new Set([0]));
  });

  it('no-ops batch actions and dialogs without a selection', async () => {
    const list = await createList([entry(0)]);

    await list.deleteSelection();
    await list.openBatchOperations();
    await list.openDelimiters();

    expect(dialogOpen).not.toHaveBeenCalled();
    expect(openResponsive).not.toHaveBeenCalled();
    // The empty-selection tap (e.g. the bottom bar's Batch edit item) says
    // so instead of doing nothing.
    expect(snackBar.open).toHaveBeenCalledWith('Select entries first to batch edit.', 'OK', {
      duration: 3000,
    });
    expect(snackBar.open).toHaveBeenCalledWith('Select entries first to apply delimiters.', 'OK', {
      duration: 3000,
    });
  });

  it('exports the selection through the project actions service', async () => {
    const exportSpy = vi.spyOn(actions, 'exportSelectedEntries').mockResolvedValue(undefined);
    const list = await createList([entry(0), entry(1)]);
    list['toggleRow'](itemAt(list, 1), true);

    list.exportSelection();

    expect(exportSpy).toHaveBeenCalledWith([1]);
  });

  it('opens the clicked entry as the active tab', async () => {
    const list = await createList([entry(0), entry(1)]);

    list['open'](itemAt(list, 1));
    expect(workspace.activeTabId()).toBe(1);
  });

  it('appends a new entry and reveals it by clearing an active filter', async () => {
    const list = await createList([entry(0, { comment: 'Saber' })]);
    list['filterModel'].set({ query: 'saber' });
    await settleFilter();

    list['add']();
    fixture.detectChanges(); // flush the append-tracking effect synchronously
    // The reveal is synchronous: the cleared query must already be in the
    // debounced mirror — scrollToEntry looks the row up on the next
    // macrotask, well inside the 200ms window, so a mirror still holding
    // 'saber' would silently drop the reveal scroll.
    expect(list['filterDebounced']()).toBe('');
    expect(list['filtered']().map((i) => i.id)).toEqual([0, 1]);
    await settle();

    expect(workspace.entries()).toHaveLength(2);
    expect(list['filter']()).toBe('');
  });

  it('duplicates a row next to its source with a (copy) title', async () => {
    const list = await createList([entry(0, { comment: 'Saber' }), entry(1, { comment: 'Rin' })]);

    list['duplicate'](itemAt(list, 0));

    const entries = workspace.entries();
    expect(entries).toHaveLength(3);
    expect(entries[1]?.comment).toBe('Saber (copy)');
    expect(entries[1]?.id).toBe(2);
  });

  it('deletes a row behind its confirm dialog and drops it from the selection', async () => {
    const deleteSpy = vi.spyOn(workspace, 'deleteEntry');
    const list = await createList([entry(0, { comment: 'Saber' }), entry(1)]);
    list['toggleRow'](itemAt(list, 0), true);

    await list['delete'](itemAt(list, 0));

    expect(openResponsive).toHaveBeenCalledTimes(1);
    const [component, config] = openResponsive.mock.calls[0] as unknown as [
      unknown,
      {
        data: { title: string; message: string; confirmLabel: string; danger: boolean };
        dialog: Record<string, string>;
        sheetPanelClass: string;
      },
    ];
    expect(component).toBe(ConfirmDialog);
    // Checkpoint-locked copy (Task 10 §3.5): the entry is named, the cost is
    // stated, and the confirm names its action.
    expect(config.data).toEqual({
      title: 'Delete entry',
      message: 'Delete “Saber”? This cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
    });
    expect(config.dialog).toEqual({ panelClass: 'app-compact-fullscreen-dialog' });
    expect(config.sheetPanelClass).toBe('app-confirm-sheet');

    expect(deleteSpy).toHaveBeenCalledWith(0);
    expect(workspace.entries().map((e) => e.id)).toEqual([1]);
    expect(list['selection']()).toEqual(new Set());
  });

  it('keeps the row and its selection when the delete confirm is dismissed', async () => {
    openResponsive.mockReturnValue({ afterDismissed: () => of(undefined) });
    const deleteSpy = vi.spyOn(workspace, 'deleteEntry');
    const list = await createList([entry(0), entry(1)]);
    list['toggleRow'](itemAt(list, 0), true);

    await list['delete'](itemAt(list, 0));

    expect(openResponsive).toHaveBeenCalledTimes(1);
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(workspace.entries().map((e) => e.id)).toEqual([0, 1]);
    expect(list['selection']()).toEqual(new Set([0]));
  });

  it('reorders entries on drop and keeps display indexes in sync', async () => {
    const list = await createList([entry(0), entry(1), entry(2)]);

    list['drop'](0, 2);

    const entries = workspace.entries();
    expect(entries.map((e) => e.id)).toEqual([1, 2, 0]);
    expect(entries.map((e) => e.extensions['display_index'])).toEqual([0, 1, 2]);
  });

  it('translates filtered viewport indexes back to working-tree indexes on drop', async () => {
    const list = await createList([
      entry(0, { comment: 'Alpha' }),
      entry(1, { comment: 'Hidden' }),
      entry(2, { comment: 'Beta' }),
    ]);
    list['filterModel'].set({ query: 'a' }); // Alpha + Beta (hidden excluded)
    await settleFilter();

    list['drop'](0, 1); // Move Alpha after Beta in the filtered view.

    expect(workspace.entries().map((e) => e.id)).toEqual([1, 2, 0]);
  });

  it('ignores out-of-range drops', async () => {
    const list = await createList([entry(0), entry(1)]);
    list['filterModel'].set({ query: 'saber' }); // filtered view is empty
    await settleFilter();

    list['drop'](0, 1);

    expect(workspace.entries().map((e) => e.id)).toEqual([0, 1]);
  });

  it('marks rows dirty against HEAD', async () => {
    const list = await createList([entry(0)]);
    // No commits exist, so every entry differs from HEAD.
    expect(list['items']()[0]?.dirty).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Range selection gestures (task 20 D1–D3, row checkbox only)
  // -------------------------------------------------------------------------

  it('keeps the range anchor across gestures and resets it with the selection', async () => {
    const list = await createList([entry(0), entry(1), entry(2), entry(3)]);
    expect(list['selectionAnchor']()).toBeNull();

    // A plain (change)-path toggle sets the anchor.
    list['toggleRow'](itemAt(list, 1), true);
    expect(list['selectionAnchor']()).toBe(1);

    // A range gesture never moves the anchor: A→C then A→E covers A→E.
    list['applyRangeGesture'](itemAt(list, 3));
    expect(list['selection']()).toEqual(new Set([1, 2, 3]));
    list['applyRangeGesture'](itemAt(list, 0)); // row 0 unselected → select 0..1
    expect(list['selection']()).toEqual(new Set([0, 1, 2, 3]));
    expect(list['selectionAnchor']()).toBe(1);

    // toggleSelectAll deliberately leaves the anchor alone.
    list.selectAllShown(false);
    expect(list['selection']()).toEqual(new Set());
    expect(list['selectionAnchor']()).toBe(1);

    // clearSelection nulls it — and so does the project-switch reset.
    list.clearSelection();
    expect(list['selectionAnchor']()).toBeNull();
    list['toggleRow'](itemAt(list, 0), true);
    expect(list['selectionAnchor']()).toBe(0);
    workspace.activeProject.set(seededProject([entry(0)], 'other-project'));
    await settle();
    expect(list['selectionAnchor']()).toBeNull();
    expect(list['selection']().size).toBe(0);
  });

  it('degrades to a plain toggle when the anchor left the filtered view', async () => {
    const list = await createList([
      entry(0, { comment: 'Alpha' }),
      entry(1, { comment: 'Beta' }),
      entry(2, { comment: 'Gamma' }),
    ]);
    list['toggleRow'](itemAt(list, 0), true); // anchor 0 → {0}
    list['filterModel'].set({ query: 'beta' });
    await settleFilter();
    expect(list['filtered']().map((i) => i.id)).toEqual([1]);

    list['applyRangeGesture'](itemAt(list, 1));

    // No range: the hidden anchor degrades to a plain toggle of the gesture
    // row (the hidden selection 0 survives, as with any plain toggle), and
    // the anchor moves to the gesture row.
    expect(list['selection']()).toEqual(new Set([0, 1]));
    expect(list['selectionAnchor']()).toBe(1);
  });

  it('range-selects from the anchor on checkbox shift-click, applying exactly once', async () => {
    const list = await createList([entry(0), entry(1), entry(2)]);
    fixture.detectChanges();
    const openSpy = vi.spyOn(workspace, 'openEntry');
    list['toggleRow'](itemAt(list, 1), true); // plain path: anchor 1 → {1}

    const shift = shiftClick(checkboxAt(2));
    await settle();
    // The activation was canceled, so `(change)` never fired and the D1
    // application is the only mutation.
    expect(shift.defaultPrevented).toBe(true);
    expect(list['selection']()).toEqual(new Set([1, 2]));

    // Exactly once, proven behaviorally: the anchor still sits on row 1, so
    // shift-clicking the now-selected row 2 deselects 1..2. A double
    // application (native toggleRow also firing) would have moved the
    // anchor to 2 and deselected only row 2.
    shiftClick(checkboxAt(2));
    await settle();
    expect(list['selection']()).toEqual(new Set());

    // The row body's open() never saw a checkbox click.
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('keeps plain checkbox clicks on the native (change) path byte-identically', async () => {
    const list = await createList([entry(0), entry(1)]);
    fixture.detectChanges();
    const openSpy = vi.spyOn(workspace, 'openEntry');
    const checkbox = checkboxAt(0);
    const emitSpy = vi.spyOn(checkbox.injector.get(MatCheckbox).change, 'emit');

    const plain = new MouseEvent('click', { bubbles: true, cancelable: true });
    checkboxInput(checkbox).dispatchEvent(plain);
    await settle();

    // Nothing intercepted: activation not canceled, the change output fired
    // exactly once, and the toggle went through the native path (which also
    // moves the range anchor).
    expect(plain.defaultPrevented).toBe(false);
    expect(emitSpy).toHaveBeenCalledTimes(1);
    expect(list['selection']()).toEqual(new Set([0]));
    expect(list['selectionAnchor']()).toBe(0);
    // ...and the row body never opened (the template's stopPropagation).
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('ranges over the filtered view and keeps selections hidden by the filter', async () => {
    const list = await createList([
      entry(0, { comment: 'Alpha' }),
      entry(1, { comment: 'Hidden' }),
      entry(2, { comment: 'Beta' }),
      entry(3, { comment: 'Gamma' }),
    ]);
    list['toggleRow'](itemAt(list, 1), true); // hidden row selected first → {1}
    list['toggleRow'](itemAt(list, 0), true); // plain toggle: anchor 0 → {0, 1}
    list['filterModel'].set({ query: 'a' }); // view: Alpha, Beta, Gamma
    await settleFilter();
    expect(list['filtered']().map((i) => i.id)).toEqual([0, 2, 3]);

    // Shift-click Gamma: the slice spans the FILTERED view only.
    shiftClick(checkboxAt(2));
    await settle();
    expect(list['selection']()).toEqual(new Set([0, 1, 2, 3]));

    // Deselect over the filtered view (anchor still 0): shift-clicking Beta
    // drops 0 and 2 while the hidden selection 1 survives.
    shiftClick(checkboxAt(1));
    await settle();
    expect(list['selection']()).toEqual(new Set([1, 3]));
  });

  it('long-press on a checkbox range-applies at LONG_PRESS_MS for touch pointers', async () => {
    const list = await createList([entry(0), entry(1), entry(2)]);
    fixture.detectChanges();
    list['toggleRow'](itemAt(list, 0), true); // anchor 0 → {0}

    pointer(checkboxAt(2), 'pointerdown', { pointerType: 'touch', clientX: 10, clientY: 10 });
    await vi.advanceTimersByTimeAsync(LONG_PRESS_MS - 1);
    expect(list['selection']()).toEqual(new Set([0]));

    await vi.advanceTimersByTimeAsync(1);
    expect(list['selection']()).toEqual(new Set([0, 1, 2]));
    // The anchor does not move on a range gesture.
    expect(list['selectionAnchor']()).toBe(0);
  });

  it('arms the long-press for touch and pen only, never the mouse', async () => {
    const list = await createList([entry(0), entry(1)]);
    fixture.detectChanges();

    pointer(checkboxAt(0), 'pointerdown', { pointerType: 'mouse' });
    await vi.advanceTimersByTimeAsync(LONG_PRESS_MS * 2);
    expect(list['selection']().size).toBe(0);

    // Pen arms; firing with no anchor degrades to the plain single toggle
    // of the gesture row and moves the anchor to it.
    pointer(checkboxAt(1), 'pointerdown', { pointerType: 'pen' });
    await vi.advanceTimersByTimeAsync(LONG_PRESS_MS);
    expect(list['selection']()).toEqual(new Set([1]));
    expect(list['selectionAnchor']()).toBe(1);
  });

  it('cancels the armed long-press on early release, pointercancel and drift', async () => {
    const list = await createList([entry(0), entry(1), entry(2)]);
    fixture.detectChanges();

    // Early release: a plain tap — the native path owns it.
    pointer(checkboxAt(0), 'pointerdown', { pointerType: 'touch' });
    await vi.advanceTimersByTimeAsync(LONG_PRESS_MS - 100);
    pointer(checkboxAt(0), 'pointerup');
    await vi.advanceTimersByTimeAsync(LONG_PRESS_MS);
    expect(list['selection']().size).toBe(0);

    // pointercancel: the virtual scroller taking over a drag — never fought.
    pointer(checkboxAt(1), 'pointerdown', { pointerType: 'touch' });
    await vi.advanceTimersByTimeAsync(LONG_PRESS_MS - 100);
    pointer(checkboxAt(1), 'pointercancel');
    await vi.advanceTimersByTimeAsync(LONG_PRESS_MS);
    expect(list['selection']().size).toBe(0);

    // Drift within the slop does not cancel; beyond it does.
    pointer(checkboxAt(2), 'pointerdown', { pointerType: 'touch', clientX: 100, clientY: 100 });
    pointer(checkboxAt(2), 'pointermove', { pointerType: 'touch', clientX: 104, clientY: 104 });
    await vi.advanceTimersByTimeAsync(LONG_PRESS_MS);
    expect(list['selection']()).toEqual(new Set([2]));
    pointer(checkboxAt(0), 'pointerdown', { pointerType: 'touch', clientX: 100, clientY: 100 });
    pointer(checkboxAt(0), 'pointermove', { pointerType: 'touch', clientX: 130, clientY: 100 });
    await vi.advanceTimersByTimeAsync(LONG_PRESS_MS);
    expect(list['selection']()).toEqual(new Set([2])); // unchanged: canceled
  });

  it('swallows the post-long-press click exactly once', async () => {
    const list = await createList([entry(0), entry(1), entry(2)]);
    fixture.detectChanges();
    list['toggleRow'](itemAt(list, 0), true); // anchor 0 → {0}
    const checkbox = checkboxAt(2);

    pointer(checkbox, 'pointerdown', { pointerType: 'touch' });
    await vi.advanceTimersByTimeAsync(LONG_PRESS_MS);
    await settle();
    expect(list['selection']()).toEqual(new Set([0, 1, 2]));

    // The release synthesizes a click: swallowed before the input's own
    // listener — no native toggle, no (change) emission.
    const swallowed = new MouseEvent('click', { bubbles: true, cancelable: true });
    checkboxInput(checkbox).dispatchEvent(swallowed);
    await settle();
    expect(swallowed.defaultPrevented).toBe(true);
    expect(list['selection']()).toEqual(new Set([0, 1, 2]));

    // Swallowed exactly once: the next plain click runs the native path and
    // toggles row 2 back off through the real (change) binding.
    const plain = new MouseEvent('click', { bubbles: true, cancelable: true });
    checkboxInput(checkbox).dispatchEvent(plain);
    await settle();
    expect(plain.defaultPrevented).toBe(false);
    expect(list['selection']()).toEqual(new Set([0, 1]));
  });

  it('clears the click swallow on the next pointerdown when no release click came', async () => {
    const list = await createList([entry(0), entry(1), entry(2)]);
    fixture.detectChanges();
    list['toggleRow'](itemAt(list, 2), true); // anchor 2 → {2}
    const checkbox = checkboxAt(0);

    // Long-press fires (range 2→0), then the release is canceled by the
    // scroller: no click is ever synthesized, the flag would linger.
    pointer(checkbox, 'pointerdown', { pointerType: 'touch' });
    await vi.advanceTimersByTimeAsync(LONG_PRESS_MS);
    await settle();
    expect(list['selection']()).toEqual(new Set([0, 1, 2]));
    pointer(checkbox, 'pointercancel');

    // The next press clears the stale swallow flag; its own tap stays native.
    pointer(checkbox, 'pointerdown', { pointerType: 'touch' });
    pointer(checkbox, 'pointerup');
    const tap = new MouseEvent('click', { bubbles: true, cancelable: true });
    checkboxInput(checkbox).dispatchEvent(tap);
    await settle();
    expect(tap.defaultPrevented).toBe(false);
    expect(list['selection']()).toEqual(new Set([1, 2])); // native toggle, row 0 off
  });

  it('suppresses the checkbox contextmenu only while a press is armed or fired', async () => {
    const list = await createList([entry(0), entry(1)]);
    fixture.detectChanges();
    const contextmenu = (): MouseEvent => {
      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      checkboxAt(0).nativeElement.dispatchEvent(event);
      return event;
    };

    // Desktop right-click with no gesture in flight: untouched.
    expect(contextmenu().defaultPrevented).toBe(false);

    // Armed touch press: suppressed (Android fires it on hold).
    pointer(checkboxAt(0), 'pointerdown', { pointerType: 'touch' });
    expect(contextmenu().defaultPrevented).toBe(true);

    // Fired and not yet swallowed: still suppressed.
    await vi.advanceTimersByTimeAsync(LONG_PRESS_MS);
    expect(list['selection']()).toEqual(new Set([0])); // no-anchor degradation
    expect(contextmenu().defaultPrevented).toBe(true);

    // The swallow click clears it again; mouse presses never suppress.
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    checkboxInput(checkboxAt(0)).dispatchEvent(click);
    expect(contextmenu().defaultPrevented).toBe(false);
    expect(list['selection']()).toEqual(new Set([0])); // swallowed: no second toggle
    pointer(checkboxAt(0), 'pointerdown', { pointerType: 'mouse' });
    expect(contextmenu().defaultPrevented).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Keyboard model (Task 10 §3.4): roving tabindex, row activation guard,
  // keyboard selection and reorder.
  // -------------------------------------------------------------------------

  it('renders roving tabindex: the active row is the one Tab stop, aria-current on it', async () => {
    await createList([entry(0), entry(1), entry(2)]);
    workspace.openEntry(1);
    fixture.detectChanges();

    const rows = (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(
      '.entry-item',
    );
    expect(rows[0]?.getAttribute('tabindex')).toBe('-1');
    expect(rows[1]?.getAttribute('tabindex')).toBe('0');
    expect(rows[1]?.getAttribute('aria-current')).toBe('true');
    expect(rows[2]?.getAttribute('tabindex')).toBe('-1');
    expect(rows[2]?.getAttribute('aria-current')).toBeNull();
  });

  it('opens from the row itself on Space/Enter, never from a nested control', async () => {
    const list = await createList([entry(0)]);
    fixture.detectChanges();
    const openSpy = vi.spyOn(workspace, 'openEntry');
    const row = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.entry-item');
    assert(row);
    const input = row.querySelector('input');
    assert(input);

    // Suffixed (keydown.enter)/(keydown.space) bindings do not answer
    // dispatched KeyboardEvents in the jsdom unit environment (they do in a
    // real browser — probe-verified 2026-10-01 on the dev server; the real
    // wiring is e2e-covered in P5). Drive the handler directly with the two
    // events it can receive: a checkbox keydown (target = the nested input,
    // bubbled) and a row keydown (target = the row itself).
    const checkboxEvent = {
      target: input,
      currentTarget: row,
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent;

    // The live bubbling bug (Task 10 §1.2): Space on the row checkbox used to
    // reach the row's (keydown.space) binding and open the editor too. The
    // guard ignores keydowns whose target is not the row.
    list['onRowKeydown'](checkboxEvent, itemAt(list, 0));
    expect(openSpy).not.toHaveBeenCalled();
    expect(checkboxEvent.preventDefault).not.toHaveBeenCalled();

    // Enter from a nested control is ignored the same way.
    list['onRowKeydown']({ ...checkboxEvent } as unknown as KeyboardEvent, itemAt(list, 0));
    expect(openSpy).not.toHaveBeenCalled();

    // …while the row itself still opens on both keys (Space is also claimed
    // so it never scroll-squeaks past the handler).
    const rowSpace = {
      target: row,
      currentTarget: row,
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent;
    list['onRowKeydown'](rowSpace, itemAt(list, 0));
    expect(rowSpace.preventDefault).toHaveBeenCalled();
    expect(openSpy).toHaveBeenCalledWith(0);

    const rowEnter = {
      target: row,
      currentTarget: row,
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent;
    list['onRowKeydown'](rowEnter, itemAt(list, 0));
    expect(rowEnter.preventDefault).toHaveBeenCalled();
    expect(openSpy).toHaveBeenCalledTimes(2);
  });

  it('Ctrl+Space toggles the focused row and parks the keyboard cursor there', async () => {
    const list = await createList([entry(0), entry(1)]);
    fixture.detectChanges();

    // DOM focus on row 1's checkbox: THAT row toggles (a focused checkbox in
    // a non-active row is still the focused row).
    checkboxInput(checkboxAt(1)).focus();
    list.toggleFocusedSelection();
    expect(list['selection']()).toEqual(new Set([1]));
    expect(list['selectionAnchor']()).toBe(1); // plain-toggle anchor semantics

    // No row focused: the active row answers.
    checkboxInput(checkboxAt(1)).blur();
    workspace.openEntry(0);
    list.toggleFocusedSelection();
    expect(list['selection']()).toEqual(new Set([0, 1]));
  });

  it('Shift+arrows extend as a continuing gesture: the anchor slice repaints from the base (anchor never moves)', async () => {
    const list = await createList([entry(0), entry(1), entry(2)]);
    fixture.detectChanges();
    workspace.openEntry(0);

    // Keyboard path: anchor 0 (plain toggle via Ctrl+Space), extend down twice.
    list.toggleFocusedSelection(); // no row focused → the active row answers
    expect(list['selection']()).toEqual(new Set([0]));
    list.extendSelection(1);
    expect(list['selection']()).toEqual(new Set([0, 1]));
    list.extendSelection(1);
    expect(list['selection']()).toEqual(new Set([0, 1, 2]));
    // The anchor stayed on row 0 through both extensions (the anchor never
    // moves on a keyboard extension).
    expect(list['selectionAnchor']()).toBe(0);

    // Stepping back up shrinks by exactly ONE row per press (the continuing
    // gesture repaints the base slice — it must NOT re-invert the range just
    // because the cursor landed on an already-selected row).
    list.extendSelection(-1);
    expect(list['selection']()).toEqual(new Set([0, 1]));
    list.extendSelection(-1);
    expect(list['selection']()).toEqual(new Set([0]));
    // Clamped at the view's top: one more step up changes nothing.
    list.extendSelection(-1);
    expect(list['selection']()).toEqual(new Set([0]));

    // Re-growing downward within the same gesture repaints from the same base.
    list.extendSelection(1);
    expect(list['selection']()).toEqual(new Set([0, 1]));
    list.extendSelection(1);
    expect(list['selection']()).toEqual(new Set([0, 1, 2]));

    // Mouse parity: the same anchor + gesture row through shift+click yields
    // the same set.
    list.clearSelection();
    list['toggleRow'](itemAt(list, 0), true);
    shiftClick(checkboxAt(2));
    await settle();
    expect(list['selection']()).toEqual(new Set([0, 1, 2]));

    // Deselect branch, keyboard: a Ctrl+Space toggle-OFF anchors a DESELECT
    // gesture — the paint is the anchor's state at gesture start, so
    // extending repaints the slice as deselected (the mouse invert would
    // instead re-select the rows the cursor re-crosses).
    checkboxInput(checkboxAt(2)).focus();
    list.toggleFocusedSelection(); // row 2 was selected: toggles OFF, cursor+anchor → 2
    expect(list['selection']()).toEqual(new Set([0, 1]));
    list.extendSelection(-1); // paint = deselected: the 1..2 slice unselects
    expect(list['selection']()).toEqual(new Set([0]));
    list.extendSelection(-1); // the 0..2 slice unselects
    expect(list['selection']()).toEqual(new Set());

    // Upward growth across the anchor (fresh gesture): an anchor BELOW the
    // cursor paints the rows above it — the gesture survives stepping past
    // where it started.
    const upList = await createList([entry(0), entry(1), entry(2)]);
    fixture.detectChanges();
    workspace.openEntry(1);
    upList.toggleFocusedSelection();
    expect(upList['selection']()).toEqual(new Set([1]));
    upList.extendSelection(-1);
    expect(upList['selection']()).toEqual(new Set([0, 1]));
    upList.extendSelection(-1); // row 0 is the first row — clamped
    expect(upList['selection']()).toEqual(new Set([0, 1]));
  });

  it('scrollToEntry only scrolls when the target sits outside the rendered window', async () => {
    const list = await createList([entry(0), entry(1), entry(2)]);
    fixture.detectChanges();
    workspace.openEntry(0);
    const vp = list['viewport']();
    const rangeSpy = vi.spyOn(vp, 'getRenderedRange').mockReturnValue({ start: 0, end: 10 });
    const scrollSpy = vi.spyOn(vp, 'scrollToIndex');

    // In-window target: the reached row is already rendered — no scroll, so
    // held Shift+arrows / J/K steps never lurch the window around.
    list.navigate(1, false); // active entry → row 1 (index 1, inside 0..10)
    await vi.advanceTimersByTimeAsync(0); // scrollToEntry defers one macrotask
    expect(scrollSpy).not.toHaveBeenCalled();

    // Out-of-window target: the guard lets the standard CDK scroll through.
    rangeSpy.mockReturnValue({ start: 3, end: 10 });
    list.navigate(1, false); // active entry → row 2 (index 2, before start 3)
    await vi.advanceTimersByTimeAsync(0);
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(scrollSpy).toHaveBeenCalledWith(2, 'smooth');
  });

  it('navigates the active entry through the filtered order, clamped at the ends', async () => {
    const list = await createList([entry(0), entry(1), entry(2)]);
    fixture.detectChanges();
    workspace.openEntry(0);

    list.navigate(1, false);
    expect(workspace.activeTabId()).toBe(1);
    list.navigate(1, false);
    expect(workspace.activeTabId()).toBe(2);
    list.navigate(1, false); // clamp — no wrap
    expect(workspace.activeTabId()).toBe(2);
    list.navigate(-1, false);
    expect(workspace.activeTabId()).toBe(1);
  });

  it('moves the active entry by one visible position through the filtered view', async () => {
    const list = await createList([
      entry(0, { comment: 'Alpha' }),
      entry(1, { comment: 'Hidden' }),
      entry(2, { comment: 'Beta' }),
      entry(3, { comment: 'Gamma' }),
    ]);
    workspace.openEntry(2); // Beta
    list['filterModel'].set({ query: 'a' }); // view: Alpha, Beta, Gamma
    await settleFilter();
    expect(list['filtered']().map((i) => i.id)).toEqual([0, 2, 3]);

    const moveSpy = vi.spyOn(workspace, 'moveEntry');
    list.moveActive(1, false); // Beta over Gamma: tree indices 2 → 3
    expect(moveSpy).toHaveBeenLastCalledWith(2, 3);
    expect(workspace.activeTabId()).toBe(2); // stays active

    // Back down the view: Beta over Gamma again (3 → 2), then over Alpha
    // (2 → 0) — the translation re-derives both tree indices per step.
    list.moveActive(-1, false);
    list.moveActive(-1, false);
    expect(moveSpy).toHaveBeenLastCalledWith(2, 0);

    // Clamped at the visible ends: Beta now leads the view, one more step up
    // changes nothing.
    list.moveActive(-1, false);
    expect(moveSpy).toHaveBeenCalledTimes(3);
  });

  it('falls back to tree order when the active entry is hidden by the filter', async () => {
    const list = await createList([
      entry(0, { comment: 'Alpha' }),
      entry(1, { comment: 'Hidden A' }),
      entry(2, { comment: 'Beta' }),
    ]);
    workspace.openEntry(1); // Hidden A — does not match the filter below
    list['filterModel'].set({ query: 'beta' }); // view: [Beta]
    await settleFilter();
    expect(list['filtered']().map((i) => i.id)).toEqual([2]);

    const moveSpy = vi.spyOn(workspace, 'moveEntry');
    list.moveActive(-1, false); // tree order: 1 → 0
    expect(moveSpy).toHaveBeenCalledWith(1, 0);
    expect(workspace.activeTabId()).toBe(1);
  });

  it('moves DOM focus with navigate only when focus follows', async () => {
    const list = await createList([entry(0), entry(1), entry(2)]);
    fixture.detectChanges();
    workspace.openEntry(0);
    fixture.detectChanges();

    const rowOf = (id: number): HTMLElement => {
      const row = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
        `.entry-item[data-entry-id="${id}"]`,
      );
      assert(row);
      return row;
    };

    // other-scope dispatch (editor): the active entry moves, focus untouched.
    list.navigate(1, false);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0); // the scroll/focus deferral windows
    expect(workspace.activeTabId()).toBe(1);
    expect(document.activeElement).not.toBe(rowOf(1));

    // list-scope dispatch: focus moves to the reached row.
    list.navigate(1, true);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    expect(workspace.activeTabId()).toBe(2);
    expect(document.activeElement).toBe(rowOf(2));
  });
});
