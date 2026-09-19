import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MatChipInputEvent } from '@angular/material/chips';
import {
  CharacterBookEntry,
  createEmptyEntry,
} from '../../../core/models/lorebook.model';
import { WorkspaceService } from '../../../core/services/workspace.service';
import { EntryUpdatesService } from '../entry-updates.service';
import { EntryKeys } from './entry-keys';
import { projectOf } from '../../../../testing/project-fixtures';

describe('EntryKeys', () => {
  let workspace: WorkspaceService;
  let updates: EntryUpdatesService;
  let fixture: ComponentFixture<EntryKeys>;

  /** (Re-)binds the component input to the entry's current workspace copy. */
  function bindEntry(entry: CharacterBookEntry): void {
    fixture.componentRef.setInput('entry', structuredClone(entry));
    fixture.detectChanges();
  }

  function currentEntry(): CharacterBookEntry {
    const entry = workspace.entries()[0];
    assert(entry);
    return entry;
  }

  async function createPane(entry: Partial<CharacterBookEntry> = {}): Promise<EntryKeys> {
    workspace.activeProject.set(
      projectOf([{ ...createEmptyEntry(0), keys: [], secondary_keys: [], ...entry }], {
        id: 'keys-project',
        title: 'Keys',
      }),
    );
    fixture = TestBed.createComponent(EntryKeys);
    bindEntry(currentEntry());
    await fixture.whenStable();
    return fixture.componentInstance;
  }

  beforeEach(async () => {
    TestBed.configureTestingModule({ imports: [EntryKeys] });
    workspace = TestBed.inject(WorkspaceService);
    updates = TestBed.inject(EntryUpdatesService);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('renders primary keys as removable chips', async () => {
    await createPane({ keys: ['saber', 'artoria'] });
    const element = fixture.nativeElement as HTMLElement;

    const chips = [...element.querySelectorAll('mat-chip-row')].map(
      (c) => c.textContent?.trim().replace(/\s*cancel$/, '') ?? '',
    );
    expect(chips).toEqual(['saber', 'artoria']);

    // Removing a chip rewrites the workspace entry.
    element.querySelector<HTMLButtonElement>('[aria-label="Remove key saber"]')?.click();
    expect(currentEntry().keys).toEqual(['artoria']);
  });

  it('adds keys through the chip input, trimmed and de-duplicated', async () => {
    await createPane({ keys: ['saber'] });
    const element = fixture.nativeElement as HTMLElement;
    const input = element.querySelector<HTMLInputElement>('input[aria-label="Add primary key"]');
    assert(input);

    updates.addKey(currentEntry(), 'keys', {
      value: '  Rin  ',
      input,
    } as unknown as MatChipInputEvent);
    expect(currentEntry().keys).toEqual(['saber', 'Rin']);
    // The chip input is cleared after a successful add.
    expect(input.value).toBe('');

    // A duplicate token (even differently spaced) is dropped.
    updates.addKey(currentEntry(), 'keys', {
      value: ' Rin ',
      input,
    } as unknown as MatChipInputEvent);
    expect(currentEntry().keys).toEqual(['saber', 'Rin']);

    // Blank tokens never become keys.
    updates.addKey(currentEntry(), 'keys', {
      value: '   ',
      input,
    } as unknown as MatChipInputEvent);
    expect(currentEntry().keys).toEqual(['saber', 'Rin']);
  });

  it('hides the secondary key grid and logic select until selective is on', async () => {
    await createPane({ keys: ['saber'], selective: false });
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('[aria-label="Secondary keys"]')).toBeNull();
    expect(element.textContent).not.toContain('Secondary Logic');

    fixture.componentRef.setInput('entry', { ...currentEntry(), selective: true });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('[aria-label="Secondary keys"]')).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('Secondary Logic');
  });

  it('renders secondary keys with removal when selective', async () => {
    await createPane({ keys: ['saber'], secondary_keys: ['artoria'], selective: true });
    const element = fixture.nativeElement as HTMLElement;

    element
      .querySelector<HTMLButtonElement>('[aria-label="Remove secondary key artoria"]')
      ?.click();

    expect(currentEntry().secondary_keys).toEqual([]);
  });

  it('renders every ST logic option and writes the pick through to the entry', async () => {
    await createPane({ keys: ['saber'], selective: true });

    const select = fixture.debugElement.query(By.css('.logic-field mat-select'));
    expect(select).toBeTruthy();

    // Options live in the lazy overlay panel: open it, then pick "AND All".
    select.componentInstance.open();
    fixture.detectChanges();
    const options = [...document.querySelectorAll('mat-option')];
    expect(options.map((o) => o.textContent?.trim())).toEqual([
      'AND Any',
      'NOT All',
      'NOT Any',
      'AND All',
    ]);
    const andAll = options.at(-1) as HTMLElement;
    andAll.click();
    fixture.detectChanges();

    expect(currentEntry().extensions['selectiveLogic']).toBe(3);
  });

  it('disables the Selective chip while the entry is constant', async () => {
    await createPane({ keys: ['saber'], constant: true });
    const chip = fixture.debugElement.query(By.css('mat-chip-option'));

    expect(fixture.componentInstance['isConstant']()).toBe(true);
    expect(chip.componentInstance.disabled).toBe(true);

    // Once the entry is no longer constant the chip enables, and a user
    // selection writes `selective` through to the workspace.
    fixture.componentRef.setInput('entry', { ...currentEntry(), constant: false });
    fixture.detectChanges();
    expect(chip.componentInstance.disabled).toBe(false);
    chip.componentInstance.selectViaInteraction();
    fixture.detectChanges();

    expect(currentEntry().selective).toBe(true);
  });

  describe('in-place chip editing', () => {
    it('edits a key on double-click and commits on Enter', async () => {
      const component = await createPane({ keys: ['saber'] });

      component['startEdit']('keys', 0, 'saber');
      expect(component['isEditing']('keys', 0)).toBe(true);
      expect(component['isEditing']('keys', 1)).toBe(false);
      expect(component['isEditing']('secondary_keys', 0)).toBe(false);

      component['setEditValue']({ target: { value: 'artoria' } } as unknown as Event);
      component['commitEdit']();

      expect(currentEntry().keys).toEqual(['artoria']);
      expect(component['editingKey']()).toBeNull();
    });

    it('commits an edited secondary key through the same path', async () => {
      const component = await createPane({
        keys: ['saber'],
        secondary_keys: ['pet'],
        selective: true,
      });

      component['startEdit']('secondary_keys', 0, 'pet');
      component['setEditValue']({ target: { value: 'lion' } } as unknown as Event);
      component['commitEdit']();

      expect(currentEntry().secondary_keys).toEqual(['lion']);
    });

    it('removes the key when the edit is emptied', async () => {
      const component = await createPane({ keys: ['saber', 'rin'] });

      component['startEdit']('keys', 0, 'saber');
      component['setEditValue']({ target: { value: '   ' } } as unknown as Event);
      component['commitEdit']();

      expect(currentEntry().keys).toEqual(['rin']);
    });

    it('collapses an edit into an existing duplicate key', async () => {
      const component = await createPane({ keys: ['saber', 'rin'] });

      component['startEdit']('keys', 1, 'rin');
      component['setEditValue']({ target: { value: 'saber' } } as unknown as Event);
      component['commitEdit']();

      // The edit collapses into the existing 'saber' key instead of duplicating.
      expect(currentEntry().keys).toEqual(['saber']);
    });

    it('keeps the key when the edit value is unchanged', async () => {
      const component = await createPane({ keys: ['saber'] });
      const updateSpy = vi.spyOn(updates, 'setKeys');

      component['startEdit']('keys', 0, 'saber');
      component['setEditValue']({ target: { value: 'saber' } } as unknown as Event);
      component['commitEdit']();

      expect(updateSpy).toHaveBeenCalledWith(currentEntry(), 'keys', ['saber']);
      expect(currentEntry().keys).toEqual(['saber']);
    });

    it('aborts cleanly when the list shrank during the edit', async () => {
      const component = await createPane({ keys: ['saber'] });
      const updateSpy = vi.spyOn(updates, 'setKeys');

      component['startEdit']('keys', 3, 'gone');
      component['commitEdit']();

      expect(updateSpy).not.toHaveBeenCalled();
      expect(component['editingKey']()).toBeNull();
    });

    it('cancels the edit without patching', async () => {
      const component = await createPane({ keys: ['saber'] });
      const updateSpy = vi.spyOn(updates, 'setKeys');

      component['startEdit']('keys', 0, 'saber');
      component['setEditValue']({ target: { value: 'changed' } } as unknown as Event);
      component['cancelEdit']();

      expect(component['editingKey']()).toBeNull();
      expect(updateSpy).not.toHaveBeenCalled();
      expect(currentEntry().keys).toEqual(['saber']);
    });

    it('is a no-op when committed with no pending edit', async () => {
      const component = await createPane({ keys: ['saber'] });
      const updateSpy = vi.spyOn(updates, 'setKeys');

      component['commitEdit']();

      expect(updateSpy).not.toHaveBeenCalled();
    });

    it('renders the in-place editor on the edited chip and focuses it', async () => {
      const component = await createPane({ keys: ['saber'] });

      component['startEdit']('keys', 0, 'saber');
      fixture.detectChanges();
      await fixture.whenStable();

      const editor = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
        '.chip-edit',
      );
      expect(editor).toBeTruthy();
      expect(editor?.value).toBe('saber');
      expect(document.activeElement).toBe(editor);
      expect(editor?.getAttribute('aria-label')).toBe('Edit primary key saber');
    });

    it('focuses the add-key box on click and never steals focus mid-edit', async () => {
      const component = await createPane({
        keys: ['saber'],
        secondary_keys: ['artoria'],
        selective: true,
      });
      const element = fixture.nativeElement as HTMLElement;

      // Focusing the outlined box moves the caret into its input.
      const primaryInput = element.querySelector<HTMLInputElement>(
        'input[aria-label="Add primary key"]',
      );
      assert(primaryInput);
      (element.querySelector('.keys-field') as HTMLElement).click();
      expect(document.activeElement).toBe(primaryInput);

      // The secondary field routes its field click to its own box.
      const secondaryInput = element.querySelector<HTMLInputElement>(
        'input[aria-label="Add secondary key"]',
      );
      assert(secondaryInput);
      (element.querySelectorAll('.keys-field')[1] as HTMLElement).click();
      expect(document.activeElement).toBe(secondaryInput);

      // While an in-place edit is pending, the click-through must not steal
      // focus — for either field's box.
      component['editingKey'].set({ field: 'keys', index: 0 });
      primaryInput.blur();
      secondaryInput.blur();
      (element.querySelector('.keys-field') as HTMLElement).click();
      expect(document.activeElement).not.toBe(primaryInput);
      (element.querySelectorAll('.keys-field')[1] as HTMLElement).click();
      expect(document.activeElement).not.toBe(secondaryInput);
    });
  });
});
