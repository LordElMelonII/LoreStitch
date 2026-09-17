import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSelect } from '@angular/material/select';
import {
  CharacterBook,
  CharacterBookEntry,
  ProjectWorkspace,
  createEmptyEntry,
} from '../../core/models/lorebook.model';
import { WorkspaceService } from '../../core/services/workspace.service';
import { type MergeDialogData, type MergeOutcome } from './merge-resolver.model';
import { MergeResolverDialog } from './merge-resolver-dialog';

/** Builds an entry with sensible defaults for merge tests. */
function entry(id: number, overrides: Partial<CharacterBookEntry> = {}): CharacterBookEntry {
  return { ...createEmptyEntry(id), ...overrides };
}

function projectOf(entries: CharacterBookEntry[]): ProjectWorkspace {
  return {
    id: 'merge-project',
    title: 'Fate',
    createdAt: 1,
    updatedAt: 1,
    targetType: 'standalone_lorebook',
    activeBook: { name: 'Fate', extensions: {}, entries },
    headCommitId: null,
    commits: [],
  };
}

/** Local book: a clash target for uid 0 and an identical-content twin for uid 1. */
function localEntries(): CharacterBookEntry[] {
  return [
    entry(0, {
      keys: ['saber'],
      comment: 'Saber',
      content: 'Saber guards Fuyuki.',
      extensions: { display_index: 4 },
    }),
    entry(1, { keys: ['rin'], comment: 'Rin', content: 'Rin studies magecraft.' }),
  ];
}

/** Incoming book: a clash (row 0), an identical duplicate (row 1), a new entry (row 2). */
function incomingBook(): CharacterBook {
  return {
    name: 'Fate Extras',
    extensions: {},
    entries: [
      entry(0, {
        keys: ['saber'],
        comment: 'Saber',
        content: 'Saber rules Fuyuki.',
        extensions: { display_index: 9 },
      }),
      entry(5, { keys: ['rin'], comment: 'Rin', content: 'Rin studies magecraft.' }),
      entry(9, { keys: ['shirou'], comment: 'Shirou', content: 'An ordinary boy.' }),
    ],
  };
}

describe('MergeResolverDialog', () => {
  let workspace: WorkspaceService;
  let closeSpy: ReturnType<typeof vi.fn>;
  let dialogData: MergeDialogData;

  /** Normalized text of an element (the templates wrap lines freely). */
  function textOf(element: Element | null | undefined): string {
    return element?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  function findButton(root: HTMLElement, label: string): HTMLButtonElement {
    const button = [...root.querySelectorAll('button')].find((b) => textOf(b) === label);
    assert(button, `expected a "${label}" button`);
    return button as HTMLButtonElement;
  }

  /** The MatSelect rendered inside one merge row (rows are keyed by index). */
  function selectOfRow(fixture: ComponentFixture<MergeResolverDialog>, index: number): MatSelect {
    const row = fixture.debugElement.queryAll(By.css('.merge-row'))[index];
    assert(row, `expected merge row ${index}`);
    return row.query(By.css('mat-select')).componentInstance as MatSelect;
  }

  /** An option of the currently open select panel (options live in the overlay). */
  function optionElement(label: string): HTMLElement {
    const option = [...document.querySelectorAll('mat-option')].find((o) => textOf(o) === label);
    assert(option, `expected an open "${label}" option`);
    return option as HTMLElement;
  }

  async function settle(fixture: ComponentFixture<MergeResolverDialog>): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  async function createDialog(
    options: { mode?: 'split' | 'unified'; incoming?: CharacterBook } = {},
  ): Promise<ComponentFixture<MergeResolverDialog>> {
    dialogData = {
      incoming: options.incoming ?? incomingBook(),
      sourceName: 'Fate Extras',
      mode: options.mode,
    };
    workspace.activeProject.set(projectOf(localEntries()));
    const fixture = TestBed.createComponent(MergeResolverDialog);
    await settle(fixture);
    return fixture;
  }

  /** Narrows the single dialog close payload to a MergeOutcome. */
  function closedOutcome(): MergeOutcome {
    expect(closeSpy).toHaveBeenCalledTimes(1);
    const call = closeSpy.mock.calls[0] as unknown[] | undefined;
    assert(call);
    const outcome = call[0] as MergeOutcome | null;
    assert(outcome);
    return outcome;
  }

  beforeEach(async () => {
    closeSpy = vi.fn();
    TestBed.configureTestingModule({
      imports: [MergeResolverDialog],
      providers: [
        { provide: MAT_DIALOG_DATA, useFactory: () => dialogData },
        { provide: MatDialogRef, useValue: { close: closeSpy } },
      ],
    });
    workspace = TestBed.inject(WorkspaceService);
    // Allow the workspace's async init() to settle before tests touch signals.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('renders one row per incoming entry, flagging clashes and identical copies', async () => {
    const fixture = await createDialog();
    const component = fixture.componentInstance;
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelectorAll('.merge-row')).toHaveLength(3);
    expect(textOf(el.querySelector('h2'))).toContain('Fate Extras');
    expect(textOf(el.querySelector('.summary'))).toContain('3 incoming entries');
    expect(component['clashCount']()).toBe(1);

    const rows = [...el.querySelectorAll('.merge-row')];
    expect(textOf(rows[0]?.querySelector('.row-title'))).toContain('Saber');
    expect(textOf(rows[0]?.querySelector('.clash-flag'))).toContain('matches local');
    expect(rows[1]?.querySelector('.identical-flag')).toBeTruthy();
    // A brand-new entry carries neither flag, but shows its activation key.
    expect(rows[2]?.querySelector('.clash-flag')).toBeNull();
    expect(rows[2]?.querySelector('.identical-flag')).toBeNull();
    expect(textOf(rows[2])).toContain('shirou');
  });

  it('seeds identical entries to skip and everything else to import', async () => {
    const fixture = await createDialog();
    const component = fixture.componentInstance;
    const el = fixture.nativeElement as HTMLElement;

    expect(component['action'](0)).toBe('import');
    expect(component['action'](1)).toBe('skip');
    expect(component['action'](2)).toBe('import');
    expect(component['pendingCounts']()).toEqual({ import: 2, overwrite: 0, skip: 1 });
    expect(textOf(el.querySelector('.pending'))).toContain('2 new · 0 overwrite · 1 skip');
  });

  it('switches a row to overwrite through the select (split mode)', async () => {
    const fixture = await createDialog({ mode: 'split' });
    const component = fixture.componentInstance;
    const el = fixture.nativeElement as HTMLElement;

    selectOfRow(fixture, 0).open();
    fixture.detectChanges();
    optionElement('Overwrite Existing').click();
    await settle(fixture);

    expect(component['action'](0)).toBe('overwrite');
    expect(component['pendingCounts']()).toEqual({ import: 1, overwrite: 1, skip: 1 });
    expect(textOf(el.querySelector('.pending'))).toContain('1 new · 1 overwrite · 1 skip');
  });

  it('switches a row to skip through the select (unified mode)', async () => {
    const fixture = await createDialog({ mode: 'unified' });
    const component = fixture.componentInstance;

    selectOfRow(fixture, 2).open();
    fixture.detectChanges();
    optionElement('Skip').click();
    await settle(fixture);

    expect(component['action'](2)).toBe('skip');
    expect(component['pendingCounts']()).toEqual({ import: 1, overwrite: 0, skip: 2 });
  });

  it('disables Overwrite for incoming entries without a local match', async () => {
    const fixture = await createDialog();
    const select = selectOfRow(fixture, 2); // 'Shirou' matches nothing local

    select.open();
    fixture.detectChanges();
    const overwrite = select.options.find((o) => o.viewValue === 'Overwrite Existing');
    assert(overwrite);
    expect(overwrite.disabled).toBe(true);
  });

  it('expands the diff against the local entry and collapses it again (split default)', async () => {
    const fixture = await createDialog(); // no mode given → 'split' fallback
    const el = fixture.nativeElement as HTMLElement;

    const toggle = el.querySelector<HTMLButtonElement>('[aria-label="Toggle diff for Saber"]');
    assert(toggle);
    toggle.click();
    await settle(fixture);

    const viewer = el.querySelector('app-diff-viewer');
    expect(viewer).toBeTruthy();
    expect(viewer?.querySelector('.diff-body.split')).toBeTruthy();
    expect(textOf(viewer?.querySelector('.diff-line.removed'))).toContain('Saber guards Fuyuki.');
    expect(textOf(viewer?.querySelector('.diff-line.added'))).toContain('Saber rules Fuyuki.');

    toggle.click();
    await settle(fixture);
    expect(el.querySelector('app-diff-viewer')).toBeNull();
  });

  it('renders the unified diff layout when opened in unified mode', async () => {
    const fixture = await createDialog({ mode: 'unified' });
    const el = fixture.nativeElement as HTMLElement;

    const toggle = el.querySelector<HTMLButtonElement>('[aria-label="Toggle diff for Saber"]');
    assert(toggle);
    toggle.click();
    await settle(fixture);

    const viewer = el.querySelector('app-diff-viewer');
    expect(viewer?.querySelector('.diff-body.unified')).toBeTruthy();
    expect(viewer?.querySelector('.split-row')).toBeNull();
    expect(textOf(viewer?.querySelector('.diff-line.removed'))).toContain('Saber guards Fuyuki.');
  });

  it('retargets rows with the bulk actions without losing per-row choices', async () => {
    const fixture = await createDialog();
    const component = fixture.componentInstance;
    const el = fixture.nativeElement as HTMLElement;

    findButton(el, 'Overwrite matched').click();
    expect(component['action'](0)).toBe('overwrite');
    // The identical and unmatched rows keep their seeded choices.
    expect(component['action'](1)).toBe('skip');
    expect(component['action'](2)).toBe('import');
    expect(component['pendingCounts']()).toEqual({ import: 1, overwrite: 1, skip: 1 });

    findButton(el, 'Skip all').click();
    expect(component['pendingCounts']()).toEqual({ import: 0, overwrite: 0, skip: 3 });

    findButton(el, 'Import all as new').click();
    expect(component['pendingCounts']()).toEqual({ import: 3, overwrite: 0, skip: 0 });
  });

  it('apply closes with an outcome reflecting the chosen actions', async () => {
    const fixture = await createDialog();
    const component = fixture.componentInstance;
    const el = fixture.nativeElement as HTMLElement;

    component['setAction'](0, 'overwrite');
    await settle(fixture);
    findButton(el, 'Apply merge').click();
    await settle(fixture);

    const outcome = closedOutcome();
    expect(outcome).toMatchObject({ imported: 1, overwritten: 1, skipped: 1 });
    expect(outcome.entries).toHaveLength(3);

    // The clashing local entry is replaced in place by the incoming version.
    const overwrittenEntry = outcome.entries.find((e) => e.id === 0);
    assert(overwrittenEntry);
    expect(overwrittenEntry.content).toBe('Saber rules Fuyuki.');
    // The overwritten entry keeps its LOCAL sidebar slot: the source file's
    // display index (9) must not leak in and collide with local rows.
    expect(overwrittenEntry.extensions['display_index']).toBe(4);
    const displayIndexes = outcome.entries.map((e) => e.extensions['display_index']);
    expect(new Set(displayIndexes).size).toBe(displayIndexes.length);

    const untouched = outcome.entries.find((e) => e.id === 1);
    assert(untouched);
    expect(untouched.content).toBe('Rin studies magecraft.');

    // The new entry is appended with a fresh id and display index.
    const importedEntry = outcome.entries.find((e) => e.id === 2);
    assert(importedEntry);
    expect(importedEntry.comment).toBe('Shirou');
    expect(importedEntry.extensions['display_index']).toBe(2);

    // The dialog only reports; the caller commits the merged book.
    expect(workspace.entries()).toHaveLength(2);
  });

  it('imports an incoming entry that carries no extensions bag', async () => {
    // Vendor files occasionally omit the optional extension payload; the
    // merge must still attach a display index instead of crashing.
    const raw = entry(4, { keys: ['caren'], comment: 'Caren', content: 'Stray note.' });
    const { extensions: _dropped, ...withoutExtensions } = raw;
    const fixture = await createDialog({
      incoming: {
        name: 'Minimal',
        extensions: {},
        entries: [withoutExtensions as CharacterBookEntry],
      },
    });
    const el = fixture.nativeElement as HTMLElement;

    findButton(el, 'Apply merge').click();
    await settle(fixture);

    const outcome = closedOutcome();
    expect(outcome.imported).toBe(1);
    const importedEntry = outcome.entries.find((e) => e.id === 2);
    assert(importedEntry);
    expect(importedEntry.extensions['display_index']).toBe(2);
    expect(importedEntry.keys).toEqual(['caren']);
  });

  it('treats an overwrite whose local entry vanished as skipped', async () => {
    const fixture = await createDialog();
    const component = fixture.componentInstance;
    const el = fixture.nativeElement as HTMLElement;

    component['setAction'](0, 'overwrite');
    workspace.deleteEntry(0);
    await settle(fixture);

    const rows = component['rows']();
    assert(rows[0]);
    expect(rows[0].local).toBeNull();

    findButton(el, 'Apply merge').click();
    await settle(fixture);

    const outcome = closedOutcome();
    expect(outcome).toMatchObject({ imported: 1, overwritten: 0, skipped: 2 });
    expect(outcome.entries.map((e) => e.id)).toEqual([1, 2]);
    expect(outcome.entries.some((e) => e.content === 'Saber rules Fuyuki.')).toBe(false);
  });

  it('explains an empty import and keeps Apply disabled', async () => {
    const fixture = await createDialog({
      incoming: { name: 'Empty', extensions: {}, entries: [] },
    });
    const el = fixture.nativeElement as HTMLElement;

    expect(textOf(el.querySelector('.no-rows'))).toContain(
      'The imported file contains no entries.',
    );
    const apply = findButton(el, 'Apply merge');
    expect(apply.disabled).toBe(true);
    apply.click();
    expect(closeSpy).not.toHaveBeenCalled();
  });

  it('cancel dismisses with a falsy outcome', async () => {
    const fixture = await createDialog();
    const el = fixture.nativeElement as HTMLElement;

    findButton(el, 'Cancel').click();
    await settle(fixture);

    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(closeSpy).toHaveBeenCalledWith(null);
  });
});
