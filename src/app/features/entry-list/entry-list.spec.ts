import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of } from 'rxjs';
import {
  CharacterBookEntry,
  ProjectWorkspace,
  createEmptyEntry,
} from '../../core/models/lorebook.model';
import { WorkspaceService } from '../../core/services/workspace.service';
import { ProjectActionsService } from '../shell/project-actions.service';
import { ResponsiveOverlayService } from '../../shared/services/responsive-overlay.service';
import { EntryList } from './entry-list';
import { BatchOperationsDialog } from './batch-operations-dialog';

/** Builds an entry with sensible defaults for list tests. */
function entry(id: number, overrides: Partial<CharacterBookEntry> = {}): CharacterBookEntry {
  return { ...createEmptyEntry(id), ...overrides };
}

function projectOf(entries: CharacterBookEntry[], id = 'test-project'): ProjectWorkspace {
  return {
    id,
    title: 'Test',
    createdAt: 1,
    updatedAt: 1,
    targetType: 'standalone_lorebook',
    activeBook: { name: 'Test', extensions: {}, entries },
    headCommitId: null,
    commits: [],
  };
}

describe('EntryList', () => {
  let workspace: WorkspaceService;
  let actions: ProjectActionsService;
  let snackBar: MatSnackBar;
  let dialogOpen: ReturnType<typeof vi.fn>;
  let openResponsive: ReturnType<typeof vi.fn>;
  let fixture: ComponentFixture<EntryList>;

  async function createList(
    entries: CharacterBookEntry[] = [],
    projectId = 'test-project',
  ): Promise<EntryList> {
    workspace.activeProject.set(projectOf(entries, projectId));
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

  beforeEach(async () => {
    // CDK BreakpointObserver (via ProjectActionsService) needs matchMedia.
    if (!window.matchMedia) {
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: (query: string) => ({
          matches: false,
          media: query,
          onchange: null,
          addListener: () => undefined,
          removeListener: () => undefined,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
          dispatchEvent: () => false,
        }),
      });
    }
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
    await new Promise((resolve) => setTimeout(resolve, 0));
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
      entry(2, { comment: 'Shielder', keys: ['mash'], content: 'A member of the round table.' }),
    ]);
    // Tag "round-table" only on entry 2; the text query must also hit tags.
    list['filterModel'].set({ query: 'ROUND TABLE' });
    expect(list['filtered']().map((i) => i.id)).toEqual([2]);

    list['filterModel'].set({ query: 'saber' });
    expect(list['filtered']().map((i) => i.id)).toEqual([0]);

    list['filterModel'].set({ query: 'tohsaka' });
    expect(list['filtered']().map((i) => i.id)).toEqual([1]);

    list['filterModel'].set({ query: 'magecraft' });
    expect(list['filtered']().map((i) => i.id)).toEqual([1]);

    list['filterModel'].set({ query: '  ' });
    expect(list['filtered']()).toHaveLength(3);
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

    list['toggleSelectAll'](true);
    expect(list['selection']()).toEqual(new Set([0]));
    expect(list['allFilteredSelected']()).toBe(true);

    // Add a hidden entry to the selection, then uncheck select-all: only the
    // shown entry is deselected, the hidden one stays selected.
    list['toggleRow'](itemAt(list, 1), true);
    expect(list['allFilteredSelected']()).toBe(true);
    list['toggleSelectAll'](false);
    expect(list['selection']()).toEqual(new Set([1]));

    // Partial coverage of the shown view reads as indeterminate.
    list['filterModel'].set({ query: '' });
    expect(list['someFilteredSelected']()).toBe(true);

    list['clearSelection']();
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
    expect(fixture.nativeElement.querySelector('.batch-count')?.textContent).toContain(
      '1 selected',
    );
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

    workspace.activeProject.set(projectOf([entry(0)], 'other-project'));
    await settle();

    expect(list['selection']().size).toBe(0);
    expect(list['tagFilter']().size).toBe(0);
  });

  it('duplicates the selection with a snackbar and no-ops on empty selection', async () => {
    const duplicateSpy = vi.spyOn(workspace, 'duplicateEntries');
    const list = await createList([entry(0), entry(1)]);

    list['duplicateSelection']();
    expect(duplicateSpy).not.toHaveBeenCalled();

    list['toggleRow'](itemAt(list, 1), true);
    list['duplicateSelection']();
    expect(duplicateSpy).toHaveBeenCalledWith([1]);
    expect(snackBar.open).toHaveBeenCalledWith('Duplicated 1 entry.', 'OK', { duration: 3000 });
  });

  it('enables and disables the selection through updateManyEntries', async () => {
    const list = await createList([entry(0), entry(1)]);
    list['toggleRow'](itemAt(list, 0), true);
    list['toggleRow'](itemAt(list, 1), true);

    list['setSelectionEnabled'](false);
    expect(workspace.entries().every((e) => !e.enabled)).toBe(true);
    expect(snackBar.open).toHaveBeenCalledWith('Disabled 2 entries.', 'OK', { duration: 3000 });

    list['setSelectionEnabled'](true);
    expect(workspace.entries().every((e) => e.enabled)).toBe(true);
    expect(snackBar.open).toHaveBeenCalledWith('Enabled 2 entries.', 'OK', { duration: 3000 });
  });

  it('deletes the selection after confirmation and clears it', async () => {
    const deleteSpy = vi.spyOn(workspace, 'deleteEntries').mockImplementation(() => undefined);
    const list = await createList([entry(0), entry(1)]);
    list['toggleRow'](itemAt(list, 0), true);
    list['toggleRow'](itemAt(list, 1), true);

    await list['deleteSelection']();

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

    await list['deleteSelection']();

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

  it('no-ops batch actions and dialogs without a selection', async () => {
    const list = await createList([entry(0)]);

    await list['deleteSelection']();
    await list.openBatchOperations();

    expect(dialogOpen).not.toHaveBeenCalled();
    expect(openResponsive).not.toHaveBeenCalled();
  });

  it('exports the selection through the project actions service', async () => {
    const exportSpy = vi.spyOn(actions, 'exportSelectedEntries').mockResolvedValue(undefined);
    const list = await createList([entry(0), entry(1)]);
    list['toggleRow'](itemAt(list, 1), true);

    list['exportSelection']();

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

    list['add']();
    await new Promise((resolve) => setTimeout(resolve, 0));
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

  it('deletes a row and drops it from the selection', async () => {
    const list = await createList([entry(0), entry(1)]);
    list['toggleRow'](itemAt(list, 0), true);

    list['delete'](itemAt(list, 0));

    expect(workspace.entries().map((e) => e.id)).toEqual([1]);
    expect(list['selection']()).toEqual(new Set());
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

    list['drop'](0, 1); // Move Alpha after Beta in the filtered view.

    expect(workspace.entries().map((e) => e.id)).toEqual([1, 2, 0]);
  });

  it('ignores out-of-range drops', async () => {
    const list = await createList([entry(0), entry(1)]);
    list['filterModel'].set({ query: 'saber' }); // filtered view is empty

    list['drop'](0, 1);

    expect(workspace.entries().map((e) => e.id)).toEqual([0, 1]);
  });

  it('marks rows dirty against HEAD', async () => {
    const list = await createList([entry(0)]);
    // No commits exist, so every entry differs from HEAD.
    expect(list['items']()[0]?.dirty).toBe(true);
  });
});
