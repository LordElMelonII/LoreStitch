import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import {
  CharacterBookEntry,
  createEmptyEntry,
  ProjectWorkspace,
} from '../../core/models/lorebook.model';
import { estimateTokens, formatTokenCount } from '../../core/services/token-estimator';
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
    expect(previews[0].replacedDelimiter).toBeNull();
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
    expect(previews[0].replacedDelimiter).toBe('<London>');

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

  it('sanitizes the typed fixed name in the preview, hint, and applied wrapper', async () => {
    const dialog = await createDialog([
      entry(0, { comment: 'London', content: 'London is a city.' }),
      entry(1, { comment: 'Paris', content: 'Paris is a city.' }),
    ]);
    dialog['setScope']('all');
    await toggleCheckbox('Use each entry'); // per-entry naming off
    await typeName('a<b');

    expect(dialog['resolvedFixedName']()).toBe('a b');
    expect(dialog['fixedNameRewritten']()).toBe(true);

    const previews = dialog['previews']();
    assert(previews[0]);
    assert(previews[1]);
    expect(previews[0].next).toBe('<a b>\nLondon is a city.\n</a b>');
    expect(previews[1].next).toBe('<a b>\nParis is a city.\n</a b>');

    // The field is never rewritten, but the applied name is previewed.
    assert(fixture);
    const hint = (fixture.nativeElement as HTMLElement).querySelector('.resolved-name-hint');
    assert(hint);
    expect(hint.textContent).toContain('Will be applied as');
    expect(hint.textContent).toContain('a b');

    dialog['apply']();
    expect(entryOf(0).content).toBe('<a b>\nLondon is a city.\n</a b>');
    expect(entryOf(1).content).toBe('<a b>\nParis is a city.\n</a b>');
  });

  it('reports a positive token delta for wrapping and neutral for a no-op', async () => {
    const dialog = await createDialog([
      entry(0, { comment: 'London', content: 'London is a city full of people.' }),
    ]);

    const previews = dialog['previews']();
    assert(previews[0]);
    const delta = previews[0].tokenDelta;
    expect(delta).toBe(estimateTokens(previews[0].next) - estimateTokens(previews[0].current));
    expect(delta).toBeGreaterThan(0);
    expect(dialog['tokenDeltaTotal']()).toBe(delta);
    expect(dialog['tokenDeltaLabel']()).toBe(`+${formatTokenCount(delta)}`);
    expect(dialog['tokenDeltaDirection']()).toBe('up');

    assert(fixture);
    const el = fixture.nativeElement as HTMLElement;
    const headerDelta = el.querySelector('.preview-header .token-delta');
    assert(headerDelta);
    expect(headerDelta.textContent).toContain(`+${formatTokenCount(delta)}`);
    expect(headerDelta.classList.contains('up')).toBe(true);
    const rowDelta = el.querySelector('.preview-row .token-delta');
    assert(rowDelta);
    expect(rowDelta.textContent).toContain(`+${formatTokenCount(delta)}`);

    // Same content, target `none`: the row is a no-op and reports `=`.
    dialog['setStyle']('none');
    expect(dialog['tokenDeltaTotal']()).toBe(0);
    expect(dialog['tokenDeltaLabel']()).toBe('=');
    expect(dialog['tokenDeltaDirection']()).toBe('neutral');
    fixture.detectChanges();
    const neutralDelta = el.querySelector('.preview-header .token-delta');
    assert(neutralDelta);
    expect(neutralDelta.textContent).toContain('=');
    expect(neutralDelta.classList.contains('neutral')).toBe(true);
  });

  it('reports a negative token delta when stripping a wrapper', async () => {
    const dialog = await createDialog([
      entry(0, { comment: 'London', content: '<London>\nLondon is a city.\n</London>' }),
    ]);
    await pickStyle('None');

    const previews = dialog['previews']();
    assert(previews[0]);
    expect(previews[0].tokenDelta).toBeLessThan(0);
    expect(dialog['tokenDeltaLabel']()).toBe(`−${formatTokenCount(-previews[0].tokenDelta)}`);
    expect(dialog['tokenDeltaDirection']()).toBe('down');

    assert(fixture);
    const headerDelta = (fixture.nativeElement as HTMLElement).querySelector(
      '.preview-header .token-delta',
    );
    assert(headerDelta);
    expect(headerDelta.textContent).toContain(`−${formatTokenCount(-previews[0].tokenDelta)}`);
    expect(headerDelta.classList.contains('down')).toBe(true);
  });

  it('leaves blank entries unchanged and out of the write set', async () => {
    const dialog = await createDialog([
      entry(0, { comment: 'Blank', content: '   ' }),
      entry(1, { comment: 'London', content: 'London is a city.' }),
    ]);
    dialog['setScope']('all');

    const previews = dialog['previews']();
    assert(previews[0]);
    assert(previews[1]);
    expect(previews[0].blank).toBe(true);
    expect(previews[0].changed).toBe(false);
    expect(previews[0].next).toBe('   ');
    expect(dialog['changedCount']()).toBe(1);
    expect(dialog['blankCount']()).toBe(1);
    expect(dialog['allBlank']()).toBe(false);

    assert(fixture);
    fixture.detectChanges();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.row-chip')?.textContent,
    ).toContain('blank');

    dialog['apply']();
    expect(closeSpy).toHaveBeenCalledWith(true);
    expect(entryOf(0).content).toBe('   ');
    expect(entryOf(1).content).toBe('<London>\nLondon is a city.\n</London>');
    expect(snackBarOpen).toHaveBeenCalledWith('Delimiters updated on 1 entry.', 'OK', {
      duration: 3500,
    });
  });

  it('treats an all-blank book as a no-op apply', async () => {
    const dialog = await createDialog([
      entry(0, { comment: 'One', content: '   ' }),
      entry(1, { comment: 'Two', content: '\n' }),
    ]);
    dialog['setScope']('all');

    expect(dialog['allBlank']()).toBe(true);
    expect(dialog['changedCount']()).toBe(0);
    assert(fixture);
    expect(applyButton().disabled).toBe(true);

    dialog['apply']();
    expect(closeSpy).toHaveBeenCalledWith(false);
    expect(snackBarOpen).not.toHaveBeenCalled();
    expect(workspace.entries().map((e) => e.content)).toEqual(['   ', '\n']);
  });

  it('strips a foreign-named wrapper when None is picked', async () => {
    const dialog = await createDialog([
      entry(0, { comment: 'New', content: '<Old>\nprose\n</Old>' }),
    ]);
    await pickStyle('None');

    const previews = dialog['previews']();
    assert(previews[0]);
    // Detection is name-agnostic: any whole-content wrapper counts.
    expect(previews[0].replacedDelimiter).toBe('<Old>');
    expect(previews[0].changed).toBe(true);
    expect(previews[0].next).toBe('prose');

    assert(fixture);
    const hint = (fixture.nativeElement as HTMLElement).querySelector('.row-hint');
    assert(hint);
    expect(hint.textContent).toContain('Will remove the existing <Old> delimiter');

    dialog['apply']();
    expect(entryOf(0).content).toBe('prose');
  });

  it('replaces a wrapper with a foreign name instead of nesting', async () => {
    const dialog = await createDialog([
      entry(0, { comment: 'New', content: '<Old>\nprose\n</Old>' }),
    ]);
    await pickStyle('Tag');

    const previews = dialog['previews']();
    assert(previews[0]);
    expect(previews[0].replacedDelimiter).toBe('<Old>');
    expect(previews[0].next).toBe('<New>\nprose\n</New>');

    assert(fixture);
    const hint = (fixture.nativeElement as HTMLElement).querySelector('.row-hint');
    assert(hint);
    expect(hint.textContent).toContain('Will replace the existing <Old> delimiter');

    dialog['apply']();
    expect(entryOf(0).content).toBe('<New>\nprose\n</New>');
  });

  it('replaces a mismatched <foo>x</bar> instead of nesting', async () => {
    const dialog = await createDialog([entry(0, { comment: 'New', content: '<foo>x</bar>' })]);
    await pickStyle('Tag');

    const previews = dialog['previews']();
    assert(previews[0]);
    // The broken pair classifies as malformed (mismatched pairs need no
    // hints), so it is stripped and rewrapped — one clean wrapper, never a
    // nest; nothing well-formed was detected, so `replacedDelimiter` stays
    // null and the malformed hint carries the explanation.
    expect(previews[0].malformed).toEqual({
      kind: 'mismatched',
      openingName: 'foo',
      closingName: 'bar',
    });
    expect(previews[0].replacedDelimiter).toBeNull();
    expect(previews[0].changed).toBe(true);
    expect(previews[0].next).toBe('<New>\nx\n</New>');

    assert(fixture);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.row-chip.malformed-chip')?.textContent).toContain('mismatched');
    const hint = el.querySelector('.row-hint');
    assert(hint);
    expect(hint.textContent).toContain('Will replace the mismatched <foo> and </bar> delimiters');

    // What is previewed is exactly what is written — no baked-in markup.
    dialog['apply']();
    expect(entryOf(0).content).toBe('<New>\nx\n</New>');
  });

  it('strips a matching wrapper when None is picked', async () => {
    const dialog = await createDialog([
      entry(0, { comment: 'Old', content: '<Old>\nprose\n</Old>' }),
    ]);
    await pickStyle('None');

    const previews = dialog['previews']();
    assert(previews[0]);
    expect(previews[0].replacedDelimiter).toBe('<Old>');
    expect(previews[0].next).toBe('prose');
  });

  it('keeps a trailing scene break when wrapping and strips it only with None', async () => {
    const dialog = await createDialog([entry(0, { comment: 'New', content: 'prose\n\n---' })]);
    await pickStyle('Tag');

    const previews = dialog['previews']();
    assert(previews[0]);
    // The `---` rides along as payload — no replacement hint for it.
    expect(previews[0].replacedDelimiter).toBeNull();
    expect(previews[0].next).toBe('<New>\nprose\n\n---\n</New>');
  });

  it('strips a separator when None is picked', async () => {
    const dialog = await createDialog([entry(0, { comment: 'New', content: 'prose\n\n---' })]);
    await pickStyle('None');

    const previews = dialog['previews']();
    assert(previews[0]);
    expect(previews[0].next).toBe('prose');
  });

  it('keeps regex metacharacters in a fixed name verbatim', async () => {
    const dialog = await createDialog([
      entry(0, { comment: 'London', content: 'London is a city.' }),
    ]);
    dialog['setScope']('all');
    await toggleCheckbox('Use each entry');
    await typeName('*+?');

    expect(dialog['resolvedFixedName']()).toBe('*+?');
    expect(dialog['fixedNameRewritten']()).toBe(false);

    const previews = dialog['previews']();
    assert(previews[0]);
    expect(previews[0].next).toBe('<*+?>\nLondon is a city.\n</*+?>');

    dialog['apply']();
    expect(entryOf(0).content).toBe('<*+?>\nLondon is a city.\n</*+?>');
  });

  it('selects a summary row as the diff target', async () => {
    const dialog = await createDialog([
      entry(0, { comment: 'London', content: 'London is a city.' }),
      entry(1, { comment: 'Paris', content: 'Paris is a city.' }),
    ]);
    dialog['setScope']('all');
    expect(dialog['previewEntry']()?.entryId).toBe(0);

    assert(fixture);
    fixture.detectChanges();
    const rows = fixture.debugElement.queryAll(By.css('.preview-row'));
    expect(rows).toHaveLength(2);
    const second = rows[1];
    assert(second);
    (second.nativeElement as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(dialog['selectedPreviewId']()).toBe(1);
    expect(dialog['previewEntry']()?.entryId).toBe(1);
  });

  it('flags malformed rows, counts them in the banner, and writes one clean wrapper pair', async () => {
    const dialog = await createDialog([
      entry(0, { comment: 'New', content: '<test>\nlore\n</universe>' }),
      entry(1, { comment: 'Fuyuki', content: '<old>\ntale\n</new>' }),
    ]);
    dialog['setScope']('all');

    const previews = dialog['previews']();
    assert(previews[0]);
    assert(previews[1]);
    expect(previews[0].malformed).toEqual({
      kind: 'mismatched',
      openingName: 'test',
      closingName: 'universe',
    });
    expect(previews[0].changed).toBe(true);
    expect(previews[0].next).toBe('<New>\nlore\n</New>');
    // The row delta reflects the swap, not a nest around the broken markup.
    expect(previews[0].tokenDelta).toBe(
      estimateTokens(previews[0].next) - estimateTokens(previews[0].current),
    );
    expect(previews[1].malformed).toEqual({
      kind: 'mismatched',
      openingName: 'old',
      closingName: 'new',
    });
    expect(dialog['malformedCount']()).toBe(2);

    // The banner sits between the format card and the preview list.
    assert(fixture);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const banner = el.querySelector('.malformed-banner');
    assert(banner);
    expect(banner.textContent).toContain('2 entries have malformed delimiters');
    expect(banner.textContent).toContain('Applying a style replaces them; None removes them.');
    expect(el.querySelector('.meta')?.textContent).toContain('· 2 malformed');

    const hints = el.querySelectorAll('.row-hint');
    expect(hints).toHaveLength(2);
    expect(hints[0]?.textContent).toContain(
      'Will replace the mismatched <test> and </universe> delimiters',
    );

    // What is previewed is exactly what is written: one wrapper pair per
    // entry, payload intact, zero nesting.
    const expected = previews.map((p) => p.next);
    dialog['apply']();
    expect(workspace.entries().map((e) => e.content)).toEqual([
      '<New>\nlore\n</New>',
      '<Fuyuki>\ntale\n</Fuyuki>',
    ]);
    expect(workspace.entries().map((e) => e.content)).toEqual(expected);
  });

  it('removes the mismatched pair and keeps the payload when None is picked', async () => {
    const dialog = await createDialog([
      entry(0, { comment: 'New', content: '<test>\nlore\n</universe>' }),
    ]);
    await pickStyle('None');

    const previews = dialog['previews']();
    assert(previews[0]);
    expect(previews[0].malformed).toEqual({
      kind: 'mismatched',
      openingName: 'test',
      closingName: 'universe',
    });
    expect(previews[0].next).toBe('lore');

    assert(fixture);
    const el = fixture.nativeElement as HTMLElement;
    const banner = el.querySelector('.malformed-banner');
    assert(banner);
    expect(banner.textContent).toContain('1 entry has malformed delimiters');
    const hint = el.querySelector('.row-hint');
    assert(hint);
    expect(hint.textContent).toContain(
      'Will remove the mismatched <test> and </universe> delimiters',
    );

    dialog['apply']();
    // The broken tags are gone; the payload survives byte-for-byte.
    expect(entryOf(0).content).toBe('lore');
  });

  it('replaces orphaned openers and closers that match the entry names', async () => {
    const dialog = await createDialog([
      entry(0, { comment: 'universe', content: '<universe>\nlore' }),
      entry(1, { comment: 'tower', content: 'tale\n</tower>' }),
    ]);
    dialog['setScope']('all');

    const previews = dialog['previews']();
    assert(previews[0]);
    assert(previews[1]);
    expect(previews[0].malformed).toEqual({ kind: 'orphan-open', name: 'universe' });
    expect(previews[0].next).toBe('<universe>\nlore\n</universe>');
    expect(previews[1].malformed).toEqual({ kind: 'orphan-close', name: 'tower' });
    expect(previews[1].next).toBe('<tower>\ntale\n</tower>');
    expect(dialog['malformedCount']()).toBe(2);

    assert(fixture);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.malformed-banner')?.textContent).toContain(
      '2 entries have malformed delimiters',
    );
    const chips = el.querySelectorAll('.row-chip.malformed-chip');
    expect(chips).toHaveLength(2);
    expect(chips[0]?.textContent).toContain('unclosed');
    const hints = el.querySelectorAll('.row-hint');
    expect(hints).toHaveLength(2);
    expect(hints[0]?.textContent).toContain('Will replace the unclosed <universe> delimiter');
    expect(hints[1]?.textContent).toContain('Will replace the unclosed </tower> delimiter');

    dialog['apply']();
    expect(entryOf(0).content).toBe('<universe>\nlore\n</universe>');
    expect(entryOf(1).content).toBe('<tower>\ntale\n</tower>');
  });

  it('keeps an orphaned opener whose name matches nothing as payload', async () => {
    const dialog = await createDialog([entry(0, { comment: 'London', content: '<div>\nlore' })]);

    const previews = dialog['previews']();
    assert(previews[0]);
    // The hint gate clears classification, so nothing is stripped and the row
    // stays byte-identical to the additive wrap it always got.
    expect(previews[0].malformed).toBeNull();
    expect(previews[0].next).toBe('<London>\n<div>\nlore\n</London>');
    expect(dialog['malformedCount']()).toBe(0);

    assert(fixture);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.malformed-banner')).toBeNull();
    expect(el.querySelector('.meta')?.textContent).not.toContain('malformed');

    dialog['apply']();
    expect(entryOf(0).content).toBe('<London>\n<div>\nlore\n</London>');
  });

  it('renders no malformed banner or meta count for clean books', async () => {
    const dialog = await createDialog([
      entry(0, { comment: 'London', content: 'London is a city.' }),
      entry(1, { comment: 'Paris', content: 'Paris is a city.' }),
    ]);
    dialog['setScope']('all');

    expect(dialog['malformedCount']()).toBe(0);
    assert(fixture);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.malformed-banner')).toBeNull();
    expect(el.querySelector('.meta')?.textContent).not.toContain('malformed');
  });
});
