import { ComponentFixture, TestBed } from '@angular/core/testing';
import { type CdkVirtualScrollViewport } from '@angular/cdk/scrolling';
import { By } from '@angular/platform-browser';
import { MAT_BOTTOM_SHEET_DATA, MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSelect } from '@angular/material/select';
import {
  CharacterBookEntry,
  ProjectWorkspace,
  createEmptyEntry,
} from '../../core/models/lorebook.model';
import { WorkspaceService } from '../../core/services/workspace.service';
import { type ExportSelection } from './export-selected.model';
import { ExportSelectedDialog, type ExportSelectedDialogData } from './export-selected-dialog';

/** Builds an entry with sensible defaults for export tests. */
function entry(id: number, overrides: Partial<CharacterBookEntry> = {}): CharacterBookEntry {
  return { ...createEmptyEntry(id), ...overrides };
}

function projectOf(entries: CharacterBookEntry[]): ProjectWorkspace {
  return {
    id: 'export-project',
    title: 'Fate',
    createdAt: 1,
    updatedAt: 1,
    targetType: 'standalone_lorebook',
    activeBook: { name: 'Fate', extensions: {}, entries },
    headCommitId: null,
    commits: [],
  };
}

/**
 * Base book: a selective entry, the entry its secondary key points at, an
 * unrelated entry, and one id-less stray that must never become a row.
 */
function baseEntries(): CharacterBookEntry[] {
  const tagged = entry(0, {
    keys: ['saber'],
    secondary_keys: ['artoria'],
    comment: 'Saber',
    content: 'a'.repeat(40), // ~10 tokens
  });
  tagged.extensions = { ...tagged.extensions, lorestitch_tags: ['fate', 'sword'] };
  return [
    tagged,
    entry(1, { keys: ['artoria'], comment: 'Artoria', content: 'b'.repeat(40) }), // ~10 tokens
    entry(2, { keys: ['rin'], comment: 'Rin', content: 'c'.repeat(20) }), // ~5 tokens
    { ...createEmptyEntry(3), id: undefined },
  ];
}

describe('ExportSelectedDialog', () => {
  let workspace: WorkspaceService;
  let closeSpy: ReturnType<typeof vi.fn>;
  let dialogData: ExportSelectedDialogData;
  /**
   * Sheet-mode stub: when set before `createDialog`, the pane is mounted the
   * way a phone bottom sheet opens it — a `MatBottomSheetRef` with the sheet
   * data token, and no dialog ref or data token at all.
   */
  let sheetRefStub: { dismiss: ReturnType<typeof vi.fn> } | null;

  /** Normalized text of an element (the templates wrap lines freely). */
  function textOf(element: Element | null | undefined): string {
    return element?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  function findButton(root: HTMLElement, label: string): HTMLButtonElement {
    const button = [...root.querySelectorAll('button')].find((b) => textOf(b) === label);
    assert(button, `expected a "${label}" button`);
    return button as HTMLButtonElement;
  }

  /** The rendered virtual-scroll row for one entry title. */
  function rowOf(root: HTMLElement, title: string): HTMLElement {
    const row = [...root.querySelectorAll('.entry-row')].find(
      (r) => textOf(r.querySelector('.row-title')) === title,
    );
    assert(row, `expected an entry row titled "${title}"`);
    return row as HTMLElement;
  }

  function checkboxOf(root: HTMLElement, title: string): HTMLInputElement | null {
    return rowOf(root, title).querySelector<HTMLInputElement>('input[type="checkbox"]');
  }

  /** The whole-row toggle button (label flips between Include/Exclude). */
  function rowToggleOf(root: HTMLElement, title: string): HTMLButtonElement {
    const button = rowOf(root, title).querySelector<HTMLButtonElement>('.row-toggle');
    assert(button, `expected a row toggle for "${title}"`);
    return button;
  }

  function sortedIds(ids: Iterable<number>): number[] {
    return [...ids].sort((a, b) => a - b);
  }

  /** Narrows the single dialog close payload to an ExportSelection. */
  function closedSelection(): ExportSelection {
    expect(closeSpy).toHaveBeenCalledTimes(1);
    const call = closeSpy.mock.calls[0] as unknown[] | undefined;
    assert(call);
    const selection = call[0] as ExportSelection | null;
    assert(selection);
    return selection;
  }

  async function settle(fixture: ComponentFixture<ExportSelectedDialog>): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  async function createDialog(
    data: ExportSelectedDialogData = {},
  ): Promise<ComponentFixture<ExportSelectedDialog>> {
    dialogData = data;
    const fixture = TestBed.createComponent(ExportSelectedDialog);
    await settle(fixture);

    // jsdom exposes no layout, so the virtual viewport measures 0px and the
    // CDK renders no rows at all. Give it a real height and force a
    // re-measure so the entry rows materialize like they would on screen.
    const viewport = fixture.debugElement.query(By.css('cdk-virtual-scroll-viewport'));
    assert(viewport);
    Object.defineProperty(viewport.nativeElement, 'clientHeight', {
      value: 440,
      configurable: true,
    });
    (viewport.componentInstance as CdkVirtualScrollViewport).checkViewportSize();
    await settle(fixture);
    return fixture;
  }

  beforeEach(async () => {
    closeSpy = vi.fn();
    sheetRefStub = null;
    TestBed.configureTestingModule({
      imports: [ExportSelectedDialog],
      providers: [
        // Factories resolve at component-creation time, so flipping
        // `sheetRefStub` before createDialog switches the mounted container.
        {
          provide: MAT_DIALOG_DATA,
          useFactory: () => (sheetRefStub ? null : dialogData),
        },
        {
          provide: MatDialogRef,
          useFactory: () => (sheetRefStub ? null : { close: closeSpy }),
        },
        { provide: MAT_BOTTOM_SHEET_DATA, useFactory: () => dialogData },
        { provide: MatBottomSheetRef, useFactory: () => sheetRefStub },
      ],
    });
    workspace = TestBed.inject(WorkspaceService);
    workspace.activeProject.set(projectOf(baseEntries()));
    // Allow the workspace's async init() to settle before tests touch signals.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('preselects the given ids and drops stale and id-less entries', async () => {
    const fixture = await createDialog({ preselectedIds: [0, 2, 99] });
    const component = fixture.componentInstance;
    const el = fixture.nativeElement as HTMLElement;

    expect(sortedIds(component['selected']())).toEqual([0, 2]);
    // The id-less stray is excluded from the pickable rows entirely.
    expect(component['rows']()).toHaveLength(3);

    expect(textOf(el.querySelector('.counts'))).toContain('2 of 3 selected');
    expect(textOf(el.querySelector('.counts'))).toContain('~15 tokens');
    expect(checkboxOf(el, 'Saber')?.checked).toBe(true);
    expect(checkboxOf(el, 'Artoria')?.checked).toBe(false);
    expect(checkboxOf(el, 'Rin')?.checked).toBe(true);
  });

  it('toggling entries updates the selection, token tally and dependency warnings', async () => {
    const fixture = await createDialog();
    const component = fixture.componentInstance;
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('.warnings')).toBeNull();

    rowToggleOf(el, 'Saber').click();
    await settle(fixture);

    expect(sortedIds(component['selected']())).toEqual([0]);
    expect(component['warnings']()).toHaveLength(1);
    const alert = el.querySelector('.warnings');
    expect(alert?.getAttribute('role')).toBe('alert');
    const warningText = textOf(alert);
    expect(warningText).toContain('1 selective trigger link');
    expect(warningText).toContain('artoria');
    expect(warningText).toContain('Artoria');
    expect(textOf(el.querySelector('.counts'))).toContain('~10 tokens');

    // Exporting the dependency target as well resolves the warning.
    rowToggleOf(el, 'Artoria').click();
    await settle(fixture);

    expect(component['warnings']()).toEqual([]);
    expect(el.querySelector('.warnings')).toBeNull();
    expect(textOf(el.querySelector('.counts'))).toContain('2 of 3 selected');
    expect(textOf(el.querySelector('.counts'))).toContain('~20 tokens');

    // The native checkbox unchecks through the same selection.
    const box = checkboxOf(el, 'Saber');
    assert(box);
    box.click();
    await settle(fixture);

    expect(component['isSelected'](0)).toBe(false);
    expect(component['isSelected'](1)).toBe(true);
  });

  it('summarizes several unexported targets behind a "+N more" suffix', async () => {
    workspace.activeProject.set(
      projectOf([
        entry(0, { keys: ['saber'], secondary_keys: ['artoria'], comment: 'Saber', content: 'x' }),
        entry(1, { keys: ['artoria'], comment: 'Artoria', content: 'x' }),
        entry(2, { keys: ['artoria'], comment: 'Artoria Alter', content: 'x' }),
      ]),
    );
    const fixture = await createDialog({ preselectedIds: [0] });
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('.warnings li')).toBeTruthy();
    const warning = el.querySelector('.warnings li');
    expect(textOf(warning)).toContain('(+1 more)');
    // With several targets the suffix is visible, so nothing is stamped hidden.
    expect(warning?.querySelector('span[hidden]')).toBeNull();
  });

  it('rewrites the selection with the All / None / Invert shortcuts', async () => {
    const fixture = await createDialog({ preselectedIds: [0] });
    const component = fixture.componentInstance;
    const el = fixture.nativeElement as HTMLElement;

    findButton(el, 'Invert').click();
    await settle(fixture);
    expect(sortedIds(component['selected']())).toEqual([1, 2]);

    findButton(el, 'All').click();
    await settle(fixture);
    expect(sortedIds(component['selected']())).toEqual([0, 1, 2]);
    expect(textOf(el.querySelector('.counts'))).toContain('3 of 3 selected');

    findButton(el, 'None').click();
    await settle(fixture);
    expect(sortedIds(component['selected']())).toEqual([]);
    expect(findButton(el, 'Export 0 entries').disabled).toBe(true);
  });

  it('defaults the title from the project and confirms with the typed name', async () => {
    const fixture = await createDialog({ preselectedIds: [1] });
    const component = fixture.componentInstance;
    const el = fixture.nativeElement as HTMLElement;

    expect(component['title']()).toBe('Fate — Selection');
    const nameInput = el.querySelector<HTMLInputElement>(
      'input[aria-label="Lorebook name for the export"]',
    );
    assert(nameInput);
    expect(nameInput.value).toBe('Fate — Selection');

    nameInput.value = 'Grail War Split';
    nameInput.dispatchEvent(new Event('input'));
    await settle(fixture);
    expect(component['title']()).toBe('Grail War Split');

    findButton(el, 'Export 1 entry').click();
    await settle(fixture);

    expect(closedSelection()).toEqual({
      entryIds: [1],
      title: 'Grail War Split',
      format: 'st_native',
    });
  });

  it('refuses to export without a selection or with a blank name', async () => {
    const fixture = await createDialog({ preselectedIds: [0] });
    const component = fixture.componentInstance;
    const el = fixture.nativeElement as HTMLElement;

    const nameInput = el.querySelector<HTMLInputElement>(
      'input[aria-label="Lorebook name for the export"]',
    );
    assert(nameInput);
    nameInput.value = '   ';
    nameInput.dispatchEvent(new Event('input'));
    await settle(fixture);

    const blankNameButton = findButton(el, 'Export 1 entry');
    expect(blankNameButton.disabled).toBe(true);
    blankNameButton.click();
    expect(closeSpy).not.toHaveBeenCalled();

    findButton(el, 'None').click();
    await settle(fixture);
    const noSelectionButton = findButton(el, 'Export 0 entries');
    expect(noSelectionButton.disabled).toBe(true);
    noSelectionButton.click();
    expect(closeSpy).not.toHaveBeenCalled();

    // The guard itself holds even when invoked programmatically.
    component['export']();
    expect(closeSpy).not.toHaveBeenCalled();
  });

  it('switches the export format and returns it in the payload', async () => {
    const fixture = await createDialog({ preselectedIds: [2] });
    const component = fixture.componentInstance;
    const el = fixture.nativeElement as HTMLElement;

    expect(component['format']()).toBe('st_native');
    expect(textOf(el.querySelector('mat-hint'))).toContain('World Info panel');

    // The format panel is a lazy overlay: open it, then pick the V2 option.
    const select = fixture.debugElement.query(By.css('mat-select')).componentInstance as MatSelect;
    select.open();
    fixture.detectChanges();
    const option = [...document.querySelectorAll('mat-option')].find((o) =>
      textOf(o).includes('Character Book JSON (V2)'),
    );
    assert(option, 'expected the character_book format option');
    (option as HTMLElement).click();
    await settle(fixture);

    expect(component['format']()).toBe('character_book');
    expect(textOf(el.querySelector('mat-hint'))).toContain('V2 spec');
    expect(textOf(el.querySelector('mat-select-trigger'))).toContain('Character Book JSON');

    findButton(el, 'Export 1 entry').click();
    await settle(fixture);

    expect(closedSelection().format).toBe('character_book');
  });

  it('cancel dismisses with a falsy result', async () => {
    const fixture = await createDialog({ preselectedIds: [0] });
    const el = fixture.nativeElement as HTMLElement;

    findButton(el, 'Cancel').click();
    await settle(fixture);

    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(closeSpy).toHaveBeenCalledWith(null);
  });

  it('opens as a phone bottom sheet and dismisses through the sheet ref', async () => {
    sheetRefStub = { dismiss: vi.fn() };
    const fixture = await createDialog({ preselectedIds: [1] });
    const component = fixture.componentInstance;
    const el = fixture.nativeElement as HTMLElement;

    // The picker still virtual-scrolls its rows inside the sheet container.
    expect(fixture.debugElement.query(By.css('cdk-virtual-scroll-viewport'))).toBeTruthy();
    expect(rowOf(el, 'Saber')).toBeTruthy();
    expect(sortedIds(component['selected']())).toEqual([1]);
    expect(closeSpy).not.toHaveBeenCalled();

    findButton(el, 'Cancel').click();
    await settle(fixture);

    expect(sheetRefStub.dismiss).toHaveBeenCalledTimes(1);
    expect(sheetRefStub.dismiss).toHaveBeenCalledWith(null);
    expect(closeSpy).not.toHaveBeenCalled();
  });
});
