import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import {
  CharacterBookEntry,
  createEmptyEntry,
  ProjectWorkspace,
} from '../../core/models/lorebook.model';
import { WorkspaceService } from '../../core/services/workspace.service';
import { DelimiterDialog } from './delimiter-dialog';

/** Builds an entry with sensible defaults for delimiter tests. */
function entry(id: number, overrides: Partial<CharacterBookEntry> = {}): CharacterBookEntry {
  return { ...createEmptyEntry(id), ...overrides };
}

function projectOf(entries: CharacterBookEntry[]): ProjectWorkspace {
  return {
    id: 'delimiter-project',
    title: 'Delimiters',
    createdAt: 1,
    updatedAt: 1,
    targetType: 'standalone_lorebook',
    activeBook: { name: 'Delimiters', extensions: {}, entries },
    headCommitId: null,
    commits: [],
  };
}

describe('DelimiterDialog', () => {
  let workspace: WorkspaceService;
  let closeSpy: ReturnType<typeof vi.fn>;
  let snackBarOpen: ReturnType<typeof vi.fn>;
  /** Mutated per test; the dialog reads it once at construction. */
  let dialogData: { activeEntryId: number | null };
  let fixture: ComponentFixture<DelimiterDialog> | null;

  /**
   * Seeds the workspace, then mounts the dialog against it. The order matters:
   * the dialog seeds its wrapper name from the active entry at construction.
   */
  async function createDialog(
    entries: CharacterBookEntry[],
    activeEntryId: number | null = 0,
  ): Promise<DelimiterDialog> {
    dialogData.activeEntryId = activeEntryId;
    workspace.activeProject.set(projectOf(entries));
    fixture = TestBed.createComponent(DelimiterDialog);
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  /** Picks a delimiter style through the real Material select overlay. */
  async function pickStyle(label: string): Promise<void> {
    assert(fixture);
    const selects = fixture.debugElement.queryAll(By.css('mat-select'));
    // selects[0] is the scope, selects[1] the delimiter style.
    const styleSelect = selects[1];
    assert(styleSelect);
    styleSelect.componentInstance.open();
    fixture.detectChanges();
    const option = [...document.querySelectorAll('mat-option')].find((o) =>
      o.textContent?.includes(label),
    );
    assert(option);
    (option as HTMLElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  /** Toggles the checkbox labelled with the given text via its native input. */
  async function toggleCheckbox(label: string): Promise<void> {
    assert(fixture);
    fixture.detectChanges();
    const boxes = fixture.debugElement.queryAll(By.css('mat-checkbox'));
    const target = boxes.find((b) => b.nativeElement.textContent?.includes(label));
    assert(target);
    const input = target.query(By.css('input'));
    assert(input);
    (input.nativeElement as HTMLInputElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  /** Types a wrapper name into the (signal-form bound) name input. */
  async function typeName(value: string): Promise<void> {
    assert(fixture);
    const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
      'input[aria-label="Wrapper name"]',
    );
    assert(input);
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function applyButton(): HTMLButtonElement {
    assert(fixture);
    const button = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      'mat-dialog-actions button:last-child',
    );
    assert(button);
    return button;
  }

  function entryOf(id: number): CharacterBookEntry {
    const found = workspace.entries().find((e) => e.id === id);
    assert(found);
    return found;
  }

  beforeEach(async () => {
    closeSpy = vi.fn();
    snackBarOpen = vi.fn();
    dialogData = { activeEntryId: 0 };
    TestBed.configureTestingModule({
      imports: [DelimiterDialog],
      providers: [
        { provide: MAT_DIALOG_DATA, useFactory: () => dialogData },
        { provide: MatDialogRef, useValue: { close: closeSpy } },
        { provide: MatSnackBar, useValue: { open: snackBarOpen } },
      ],
    });
    workspace = TestBed.inject(WorkspaceService);
    // Allow the service's async init() to settle before assertions.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('seeds the wrapper name from the active entry and previews its wrap', async () => {
    const dialog = await createDialog([
      entry(0, { comment: 'London', content: 'London is a city full of people.' }),
      entry(1, { comment: 'Paris', content: 'Paris is a city.' }),
    ]);

    expect(dialog['name']()).toBe('London');
    const previews = dialog['previews']();
    expect(previews).toHaveLength(1); // default scope: this entry only
    assert(previews[0]);
    expect(previews[0].next).toBe('<London>\nLondon is a city full of people.\n</London>');
    expect(previews[0].changed).toBe(true);
    expect(dialog['changedCount']()).toBe(1);

    // The reference format card mirrors the seeded name.
    assert(fixture);
    expect((fixture.nativeElement as HTMLElement).querySelector('.example-text')?.textContent).toBe(
      '<London>\nEntry content…\n</London>',
    );

    // Applying writes the wrap through the workspace and resolves truthy.
    dialog['apply']();
    expect(closeSpy).toHaveBeenCalledWith(true);
    expect(entryOf(0).content).toBe('<London>\nLondon is a city full of people.\n</London>');
    expect(entryOf(1).content).toBe('Paris is a city.'); // out of scope, untouched
    expect(snackBarOpen).toHaveBeenCalledWith('Delimiters updated on 1 entry.', 'OK', {
      duration: 3500,
    });
  });

  it('never double-wraps entries that already carry the target style', async () => {
    const tagged = '<Fuyuki>\nEmiya shrine lore.\n</Fuyuki>';
    const dialog = await createDialog(
      [
        entry(0, { comment: 'Fuyuki', content: tagged }),
        entry(1, { comment: 'Rin', content: 'Plain lore text.' }),
      ],
      null,
    );
    dialog['setScope']('all');

    const previews = dialog['previews']();
    assert(previews[0]);
    assert(previews[1]);
    // Already wrapped: the preview is a no-op for that entry.
    expect(previews[0].changed).toBe(false);
    expect(previews[0].next).toBe(tagged);
    expect(previews[1].next).toBe('<Rin>\nPlain lore text.\n</Rin>');
    expect(dialog['changedCount']()).toBe(1);

    dialog['apply']();
    // The wrapped entry is byte-identical — no nesting happened.
    expect(entryOf(0).content).toBe(tagged);
    expect(entryOf(1).content).toBe('<Rin>\nPlain lore text.\n</Rin>');
  });

  it('rewraps an existing tag into the style picked in the select', async () => {
    const dialog = await createDialog([
      entry(0, { comment: 'London', content: '<London>\nLondon is a city.\n</London>' }),
    ]);
    await pickStyle('Bracket');

    const previews = dialog['previews']();
    assert(previews[0]);
    expect(previews[0].current).toBe('<London>\nLondon is a city.\n</London>');
    // The old wrapper is stripped before the new one is applied.
    expect(previews[0].next).toBe('[London=\nLondon is a city.]');

    assert(fixture);
    expect((fixture.nativeElement as HTMLElement).querySelector('.example-text')?.textContent).toBe(
      '[London=\nEntry content…\n]',
    );
  });

  it('strips a recognized wrapper back to the bare inner text', async () => {
    const dialog = await createDialog([
      entry(0, { comment: 'Fuyuki', content: '[Fuyuki=\nEmiya shrine lore.\n]' }),
    ]);
    await pickStyle('None');

    const previews = dialog['previews']();
    assert(previews[0]);
    expect(previews[0].next).toBe('Emiya shrine lore.');

    // Styles without a name hide the wrapper-name controls entirely.
    assert(fixture);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('input[aria-label="Wrapper name"]'),
    ).toBeNull();

    dialog['apply']();
    expect(entryOf(0).content).toBe('Emiya shrine lore.');
  });

  it('switches targets from the active entry to the whole book via the scope select', async () => {
    const dialog = await createDialog([
      entry(0, { comment: 'London', content: 'London is a city.' }),
      entry(1, { comment: 'Paris', content: 'Paris is a city.' }),
    ]);
    expect(dialog['targets']().map((e) => e.id)).toEqual([0]);
    assert(fixture);
    expect((fixture.nativeElement as HTMLElement).querySelector('.meta')?.textContent).toContain(
      '1 of 1 entry will change',
    );

    assert(fixture);
    const selects = fixture.debugElement.queryAll(By.css('mat-select'));
    assert(selects[0]);
    selects[0].componentInstance.open();
    fixture.detectChanges();
    const all = [...document.querySelectorAll('mat-option')].find((o) =>
      o.textContent?.includes('All entries'),
    );
    assert(all);
    (all as HTMLElement).click();
    fixture.detectChanges();

    expect(dialog['targets']().map((e) => e.id)).toEqual([0, 1]);
    expect(dialog['changedCount']()).toBe(2);
    expect(applyButton().textContent).toContain('Apply to 2 entries');

    dialog['apply']();
    expect(closeSpy).toHaveBeenCalledWith(true);
    expect(workspace.entries().map((e) => e.content)).toEqual([
      '<London>\nLondon is a city.\n</London>',
      '<Paris>\nParis is a city.\n</Paris>',
    ]);
  });

  it('names wrappers after the first primary key when key mode is on', async () => {
    const dialog = await createDialog([
      entry(0, { comment: 'River', keys: ['thames', 'water'], content: 'Flows east.' }),
      entry(1, { comment: 'Tower', keys: [], content: 'Stands tall.' }),
    ]);
    dialog['setScope']('all');
    await toggleCheckbox('Use first primary key');

    const previews = dialog['previews']();
    assert(previews[0]);
    assert(previews[1]);
    expect(previews[0].next).toBe('<thames>\nFlows east.\n</thames>');
    // Entries without keys fall back to their own name.
    expect(previews[1].next).toBe('<Tower>\nStands tall.\n</Tower>');

    // The fixed name input locks: per-entry keys win.
    assert(fixture);
    const nameInput = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
      'input[aria-label="Wrapper name"]',
    );
    assert(nameInput);
    expect(nameInput.disabled).toBe(true);

    dialog['apply']();
    expect(entryOf(0).content).toBe('<thames>\nFlows east.\n</thames>');
    expect(entryOf(1).content).toBe('<Tower>\nStands tall.\n</Tower>');
  });

  it('falls back to one fixed wrapper name when per-entry naming is off', async () => {
    const dialog = await createDialog([
      entry(0, { comment: 'London', content: 'London is a city.' }),
      entry(1, { comment: 'Paris', content: 'Paris is a city.' }),
    ]);
    dialog['setScope']('all');
    await toggleCheckbox('Use each entry'); // per-entry names off
    await typeName('Realm');

    const previews = dialog['previews']();
    assert(previews[0]);
    assert(previews[1]);
    expect(previews[0].next).toBe('<Realm>\nLondon is a city.\n</Realm>');
    expect(previews[1].next).toBe('<Realm>\nParis is a city.\n</Realm>');
  });

  it('blocks apply while the required wrapper name is missing', async () => {
    const dialog = await createDialog([
      entry(0, { comment: 'London', content: 'London is a city.' }),
    ]);
    await typeName('   ');

    expect(dialog['nameMissing']()).toBe(true);
    assert(fixture);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.pattern-error')?.textContent).toContain(
      'A name is required for this style.',
    );
    expect(applyButton().disabled).toBe(true);
  });

  it('skips the write entirely when nothing would change', async () => {
    const dialog = await createDialog([
      entry(0, { comment: 'London', content: '<London>\nLondon is a city.\n</London>' }),
    ]);
    expect(dialog['changedCount']()).toBe(0);
    expect(applyButton().disabled).toBe(true);

    dialog['apply']();
    expect(closeSpy).toHaveBeenCalledWith(false);
    expect(snackBarOpen).not.toHaveBeenCalled();
    expect(entryOf(0).content).toBe('<London>\nLondon is a city.\n</London>');
  });

  it('cancels falsy without touching the workspace', async () => {
    await createDialog([entry(0, { comment: 'London', content: 'London is a city.' })]);
    assert(fixture);
    const cancel = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      'mat-dialog-actions button:first-child',
    );
    assert(cancel);
    cancel.click();

    expect(closeSpy).toHaveBeenCalledWith(false);
    expect(entryOf(0).content).toBe('London is a city.');
  });
});
