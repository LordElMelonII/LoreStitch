import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MatChipOption } from '@angular/material/chips';
import { CharacterBookEntry, createEmptyEntry } from '../../../core/models/lorebook.model';
import { WorkspaceService } from '../../../core/services/workspace.service';
import { EntryInclusionGroup } from './entry-inclusion-group';

describe('EntryInclusionGroup', () => {
  let workspace: WorkspaceService;
  let fixture: ComponentFixture<EntryInclusionGroup>;

  function currentEntry(): CharacterBookEntry {
    const entry = workspace.entries()[0];
    assert(entry);
    return entry;
  }

  async function createPane(
    overrides: Partial<CharacterBookEntry> = {},
  ): Promise<EntryInclusionGroup> {
    workspace.activeProject.set({
      id: 'inclusion-project',
      title: 'Inclusion',
      createdAt: 1,
      updatedAt: 1,
      targetType: 'standalone_lorebook',
      activeBook: {
        name: 'Inclusion',
        extensions: {},
        entries: [{ ...createEmptyEntry(0), ...overrides }],
      },
      headCommitId: null,
      commits: [],
    });
    fixture = TestBed.createComponent(EntryInclusionGroup);
    fixture.componentRef.setInput('entry', structuredClone(currentEntry()));
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture.componentInstance;
  }

  /** Rebinds the input to the entry's current workspace copy, like the
   * enclosing accordion does after every CD cycle. */
  function rebind(): void {
    fixture.componentRef.setInput('entry', structuredClone(currentEntry()));
    fixture.detectChanges();
  }

  /** Opens the tri-state select and picks the option with the given text. */
  async function pickScoring(label: string): Promise<void> {
    const select = fixture.debugElement.query(By.css('.logic-field mat-select'));
    assert(select);
    select.componentInstance.open();
    fixture.detectChanges();
    const option = [...document.querySelectorAll('mat-option')].find(
      (o) => o.textContent?.trim() === label,
    );
    assert(option);
    option.dispatchEvent(new MouseEvent('click'));
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(async () => {
    TestBed.configureTestingModule({ imports: [EntryInclusionGroup] });
    workspace = TestBed.inject(WorkspaceService);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('seeds the group and weight from the extensions', async () => {
    const component = await createPane({
      extensions: { ...createEmptyEntry(0).extensions, group: 'grail-war', group_weight: 250 },
    });

    expect(component['model']()).toEqual({ group: 'grail-war', groupWeight: 250 });
  });

  it('falls back to the unset defaults for corrupt extensions', async () => {
    const component = await createPane({
      extensions: { ...createEmptyEntry(0).extensions, group: 47, group_weight: 'bogus' },
    });

    expect(component['model']()).toEqual({ group: '', groupWeight: null });
  });

  it('writes the group label and weight through to the extensions', async () => {
    const component = await createPane();

    component['model'].set({ group: 'grail-war', groupWeight: 250 });
    await fixture.whenStable();

    const ext = currentEntry().extensions;
    expect(ext['group']).toBe('grail-war');
    expect(ext['group_weight']).toBe(250);
    // Unrelated extension data survives the patch.
    expect(ext['probability']).toBe(100);
  });

  it('stores the ST weight default of 100 when the field is cleared', async () => {
    const component = await createPane({
      extensions: { ...createEmptyEntry(0).extensions, group: 'grail-war', group_weight: 250 },
    });

    component['model'].set({ group: '', groupWeight: null });
    await fixture.whenStable();

    const ext = currentEntry().extensions;
    expect(ext['group']).toBe('');
    expect(ext['group_weight']).toBe(100);
  });

  it('flags group weights outside the 1–10000 ST range', async () => {
    const component = await createPane();
    const weight = component['groupForm'].groupWeight;

    component['model'].set({ group: '', groupWeight: 0 });
    await fixture.whenStable();
    expect(weight().errors()[0]?.message).toBe('Group weight cannot be below 1');

    component['model'].set({ group: '', groupWeight: 10001 });
    await fixture.whenStable();
    expect(weight().errors()[0]?.message).toBe('Group weight cannot be above 10000');

    // The ST boundaries themselves stay clean.
    component['model'].set({ group: '', groupWeight: 1 });
    await fixture.whenStable();
    expect(weight().errors()).toEqual([]);
    component['model'].set({ group: '', groupWeight: 10000 });
    await fixture.whenStable();
    expect(weight().errors()).toEqual([]);
    expect(currentEntry().extensions['group_weight']).toBe(10000);
  });

  it('toggles Prioritize Inclusion into group_override', async () => {
    await createPane();
    const chip = fixture.debugElement.query(
      By.css('mat-chip-option'),
    ).componentInstance as MatChipOption;

    chip.toggleSelected(true);
    rebind();

    expect(currentEntry().extensions['group_override']).toBe(true);
    // The stored state feeds back into the chip selection.
    const selected = fixture.debugElement.query(
      By.css('mat-chip-option'),
    ).componentInstance as MatChipOption;
    expect(selected.selected).toBe(true);
  });

  it('offers the three tri-state scoring choices and writes the pick', async () => {
    await createPane();

    await pickScoring('Enabled');
    expect(currentEntry().extensions['use_group_scoring']).toBe(true);

    await pickScoring('Disabled');
    expect(currentEntry().extensions['use_group_scoring']).toBe(false);

    await pickScoring('Default (book setting)');
    expect(currentEntry().extensions['use_group_scoring']).toBeNull();
  });

  it('reads a stored numeric score as a truthy enabled state', async () => {
    const component = await createPane({
      extensions: { ...createEmptyEntry(0).extensions, use_group_scoring: 0.5 },
    });

    // SillyTavern persists the computed score; it displays as Enabled.
    expect(component['groupScoring']()).toBe(true);

    // Zero counts as disabled; absent values keep the "Default" null state.
    fixture.componentRef.setInput('entry', {
      ...currentEntry(),
      extensions: { ...currentEntry().extensions, use_group_scoring: 0 },
    });
    fixture.detectChanges();
    expect(component['groupScoring']()).toBe(false);
  });
});
