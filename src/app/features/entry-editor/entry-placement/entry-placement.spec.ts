import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { CharacterBookEntry, createEmptyEntry } from '../../../core/models/lorebook.model';
import { WorkspaceService } from '../../../core/services/workspace.service';
import { EntryPlacement } from './entry-placement';
import { projectOf } from '../../../../testing/project-fixtures';

describe('EntryPlacement', () => {
  let workspace: WorkspaceService;
  let fixture: ComponentFixture<EntryPlacement>;

  function currentEntry() {
    const entry = workspace.entries()[0];
    assert(entry);
    return entry;
  }

  async function createPane(
    overrides: Partial<CharacterBookEntry> = {},
  ): Promise<EntryPlacement> {
    workspace.activeProject.set(
      projectOf([{ ...createEmptyEntry(0), ...overrides }], { id: 'placement-project', title: 'Placement' }),
    );
    fixture = TestBed.createComponent(EntryPlacement);
    fixture.componentRef.setInput('entry', structuredClone(currentEntry()));
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture.componentInstance;
  }

  beforeEach(async () => {
    TestBed.configureTestingModule({ imports: [EntryPlacement] });
    workspace = TestBed.inject(WorkspaceService);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('shows the position select with every ST insertion point', async () => {
    await createPane();

    const select = fixture.debugElement.query(By.css('.position mat-select'));
    select.componentInstance.open();
    fixture.detectChanges();
    const options = [...document.querySelectorAll('mat-option')];
    expect(options.map((o) => o.textContent?.trim())).toEqual([
      'Before Char Defs',
      'After Char Defs',
      'Before Example Messages',
      'After Example Messages',
      'Top of Author’s Note',
      'Bottom of Author’s Note',
      '@ Depth',
      'Outlet (manual)',
    ]);
  });

  it('picks a position and keeps the ST-native mirror in sync', async () => {
    await createPane();

    const select = fixture.debugElement.query(By.css('.position mat-select'));
    select.componentInstance.open();
    fixture.detectChanges();
    [...document.querySelectorAll('mat-option')]
      .find((o) => o.textContent?.includes('After Char Defs'))
      ?.dispatchEvent(new MouseEvent('click'));
    fixture.detectChanges();

    const entry = currentEntry();
    expect(entry.position).toBe('after_char');
    // The numeric mirror is what exports round-trip.
    expect(entry.extensions['position']).toBe(1);
  });

  it('shows depth & role only at @Depth, outlet only for outlet entries', async () => {
    await createPane({ position: 'before_char' });
    let element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).not.toContain('Depth');
    expect(element.textContent).not.toContain('Outlet Name');
    expect(element.querySelector('.num input')).toBeTruthy(); // priority

    fixture.componentRef.setInput('entry', { ...currentEntry(), position: 'at_depth' });
    fixture.detectChanges();
    await fixture.whenStable();
    element = fixture.nativeElement;
    expect(element.textContent).toContain('Depth');
    expect(element.textContent).toContain('Role');
    expect(element.textContent).not.toContain('Outlet Name');

    fixture.componentRef.setInput('entry', { ...currentEntry(), position: 'outlet' });
    fixture.detectChanges();
    await fixture.whenStable();
    element = fixture.nativeElement;
    expect(element.textContent).toContain('Outlet Name');
    expect(element.textContent).not.toContain('Role');
  });

  it('seeds the form from the entry extensions and priority', async () => {
    await createPane({
      priority: 3,
      extensions: {
        ...createEmptyEntry(0).extensions,
        depth: 7,
        outlet_name: 'scene-notes',
      },
    });
    const component = fixture.componentInstance;

    expect(component['model']()).toEqual({
      depth: 7,
      outletName: 'scene-notes',
      priority: 3,
    });
  });

  it('falls back to defaults for corrupt or missing extensions', async () => {
    await createPane({
      extensions: { ...createEmptyEntry(0).extensions, depth: 'bogus', outlet_name: 42 },
    });

    expect(fixture.componentInstance['model']()).toEqual({
      depth: 4,
      outletName: '',
      priority: null,
    });
  });

  it('writes depth, outlet name and priority back to the workspace', async () => {
    await createPane();
    const component = fixture.componentInstance;

    component['model'].set({ depth: 2, outletName: 'scene-notes', priority: 9 });
    await fixture.whenStable();

    const entry = currentEntry();
    expect(entry.priority).toBe(9);
    expect(entry.extensions['depth']).toBe(2);
    expect(entry.extensions['outlet_name']).toBe('scene-notes');
    // Unrelated extension data survives the patch.
    expect(entry.extensions['probability']).toBe(100);
    expect(entry.extensions['display_index']).toBe(0);
  });

  it('drops a cleared priority instead of writing null', async () => {
    await createPane({ priority: 5 });
    const component = fixture.componentInstance;

    component['model'].set({ depth: 4, outletName: '', priority: null });
    await fixture.whenStable();

    expect(currentEntry().priority).toBeUndefined();
  });

  it('flags a negative depth through the form validation state', async () => {
    // The depth input only renders for @ Depth entries.
    await createPane({ position: 'at_depth' });
    const component = fixture.componentInstance;
    const depth = component['placementForm'].depth;

    component['model'].set({ depth: -1, outletName: '', priority: null });
    await fixture.whenStable();
    const [minError] = depth().errors();
    expect(minError?.kind).toBe('min');
    expect(minError?.message).toBe('Depth cannot be negative');
    expect(depth().errors()).toHaveLength(1);

    // The boundary value and positives stay clean.
    component['model'].set({ depth: 0, outletName: '', priority: null });
    await fixture.whenStable();
    expect(depth().errors()).toEqual([]);

    component['model'].set({ depth: 12, outletName: '', priority: null });
    await fixture.whenStable();
    expect(depth().errors()).toEqual([]);
    expect(currentEntry().extensions['depth']).toBe(12);
  });

  it('writes the at-depth role into the extensions', async () => {
    await createPane({ position: 'at_depth' });
    fixture.detectChanges();
    await fixture.whenStable();

    const selects = fixture.debugElement.queryAll(By.css('mat-select'));
    const roleSelect = selects.at(-1);
    assert(roleSelect);
    roleSelect.componentInstance.open();
    fixture.detectChanges();
    [...document.querySelectorAll('mat-option')]
      .find((o) => o.textContent?.includes('User'))
      ?.dispatchEvent(new MouseEvent('click'));
    fixture.detectChanges();

    expect(currentEntry().extensions['role']).toBe(1);
  });
});
