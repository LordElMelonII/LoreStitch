import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MatChipOption } from '@angular/material/chips';
import { CharacterBookEntry, createEmptyEntry } from '../../../core/models/lorebook.model';
import { WorkspaceService } from '../../../core/services/workspace.service';
import { EntryRecursionTiming } from './entry-recursion-timing';
import { projectOf } from '../../../../testing/project-fixtures';

describe('EntryRecursionTiming', () => {
  let workspace: WorkspaceService;
  let fixture: ComponentFixture<EntryRecursionTiming>;

  function currentEntry() {
    const entry = workspace.entries()[0];
    assert(entry);
    return entry;
  }

  async function createPane(
    overrides: Partial<CharacterBookEntry> = {},
  ): Promise<EntryRecursionTiming> {
    workspace.activeProject.set(
      projectOf([{ ...createEmptyEntry(0), ...overrides }], { id: 'recursion-project', title: 'Recursion' }),
    );
    fixture = TestBed.createComponent(EntryRecursionTiming);
    fixture.componentRef.setInput('entry', structuredClone(currentEntry()));
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture.componentInstance;
  }

  /** The three guard chips in template order, as component instances. */
  function guardChips(): [MatChipOption, MatChipOption, MatChipOption] {
    const options = fixture.debugElement
      .queryAll(By.css('mat-chip-option'))
      .map((c) => c.componentInstance as MatChipOption);
    assert(options.length === 3);
    return options as [MatChipOption, MatChipOption, MatChipOption];
  }

  beforeEach(async () => {
    TestBed.configureTestingModule({ imports: [EntryRecursionTiming] });
    workspace = TestBed.inject(WorkspaceService);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('reads guard flags from the extensions into the chips', async () => {
    await createPane({
      extensions: {
        ...createEmptyEntry(0).extensions,
        exclude_recursion: true,
        prevent_recursion: false,
        delay_until_recursion: 2,
      },
    });
    const [exclude, prevent, delay] = guardChips();

    expect(exclude.selected).toBe(true);
    expect(prevent.selected).toBe(false);
    expect(delay.selected).toBe(true);
    expect(fixture.componentInstance['delayUntilRecursion']()).toBe(2);
  });

  it('shows the recursion level input only while delayed', async () => {
    await createPane();
    expect(fixture.nativeElement.textContent).not.toContain('Recursion Level');

    fixture.componentRef.setInput(
      'entry',
      structuredClone({
        ...currentEntry(),
        extensions: { ...currentEntry().extensions, delay_until_recursion: true },
      }),
    );
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('Recursion Level');
    expect(fixture.componentInstance['delayUntilRecursion']()).toBe(true);
  });

  it('maps the stored delay shape to the form model (true = level unset)', async () => {
    await createPane({
      extensions: {
        ...createEmptyEntry(0).extensions,
        delay_until_recursion: true,
        sticky: 3,
        cooldown: null,
        delay: 5,
      },
    });

    // The world-info.js `true` level reads as "not set" in the numeric input.
    expect(fixture.componentInstance['model']()).toEqual({
      recursionLevel: null,
      sticky: 3,
      cooldown: null,
      delay: 5,
    });
  });

  it('writes numeric timing values back into the extensions', async () => {
    await createPane({ extensions: { ...createEmptyEntry(0).extensions, delay_until_recursion: true } });
    const component = fixture.componentInstance;

    component['model'].set({ recursionLevel: 3, sticky: 2, cooldown: 1, delay: 4 });
    await fixture.whenStable();

    const ext = currentEntry().extensions;
    expect(ext['delay_until_recursion']).toBe(3);
    expect(ext['sticky']).toBe(2);
    expect(ext['cooldown']).toBe(1);
    expect(ext['delay']).toBe(4);
    // Unrelated extension data survives the patch.
    expect(ext['probability']).toBe(100);
  });

  it('normalizes level 1 and cleared levels to the plain `true` of world-info.js', async () => {
    await createPane();
    const component = fixture.componentInstance;

    component['model'].set({ recursionLevel: 1, sticky: null, cooldown: null, delay: null });
    await fixture.whenStable();
    expect(currentEntry().extensions['delay_until_recursion']).toBe(true);

    component['model'].set({ recursionLevel: null, sticky: null, cooldown: null, delay: null });
    await fixture.whenStable();
    expect(currentEntry().extensions['delay_until_recursion']).toBe(true);
  });

  it('validates the numeric floors of every timing field', async () => {
    await createPane();
    const component = fixture.componentInstance;
    const form = component['timingForm'];

    component['model'].set({ recursionLevel: 0, sticky: -1, cooldown: -2, delay: -3 });
    await fixture.whenStable();

    expect(form.recursionLevel().errors()[0]?.message).toBe('Recursion level starts at 1');
    expect(form.sticky().errors()[0]?.message).toBe('Sticky cannot be negative');
    expect(form.cooldown().errors()[0]?.message).toBe('Cooldown cannot be negative');
    expect(form.delay().errors()[0]?.message).toBe('Delay cannot be negative');

    component['model'].set({ recursionLevel: 2, sticky: 0, cooldown: 0, delay: 0 });
    await fixture.whenStable();
    expect(form.sticky().errors()).toEqual([]);
    expect(form.cooldown().errors()).toEqual([]);
    expect(form.delay().errors()).toEqual([]);
  });

  /** Rebinds the input to the entry's current workspace copy, like the
   * enclosing accordion does after every CD cycle. */
  function rebind(): void {
    fixture.componentRef.setInput('entry', structuredClone(currentEntry()));
    fixture.detectChanges();
  }

  it('toggles the recursion guard chips through to the extensions', async () => {
    await createPane();
    const [exclude, prevent, delay] = guardChips();

    exclude.toggleSelected(true);
    rebind();
    expect(currentEntry().extensions['exclude_recursion']).toBe(true);

    prevent.toggleSelected(true);
    rebind();
    expect(currentEntry().extensions['prevent_recursion']).toBe(true);
    expect(currentEntry().extensions['exclude_recursion']).toBe(true);

    // Enabling delay at level 1 stores the plain `true`.
    delay.toggleSelected(true);
    rebind();
    expect(currentEntry().extensions['delay_until_recursion']).toBe(true);
  });

  it('resets a deeper delay level on untick and restarts at level 1', async () => {
    await createPane({
      extensions: { ...createEmptyEntry(0).extensions, delay_until_recursion: 2 },
    });
    const [, , delay] = guardChips();

    delay.toggleSelected(true);
    rebind();
    expect(currentEntry().extensions['delay_until_recursion']).toBe(false);

    // Re-enabling starts over at the world-info.js level-1 `true`; the level
    // is then chosen through the recursion-level input.
    delay.toggleSelected(true);
    rebind();
    expect(currentEntry().extensions['delay_until_recursion']).toBe(true);
  });
});
