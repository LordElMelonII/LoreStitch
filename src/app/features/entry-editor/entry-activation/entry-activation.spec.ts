import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MatChipOption } from '@angular/material/chips';
import {
  CharacterBookEntry,
  createEmptyEntry,
  ST_TRIGGER_OPTIONS,
  StTrigger,
} from '../../../core/models/lorebook.model';
import { WorkspaceService } from '../../../core/services/workspace.service';
import { EntryActivation } from './entry-activation';
import { projectOf } from '../../../../testing/project-fixtures';

describe('EntryActivation', () => {
  let workspace: WorkspaceService;
  let fixture: ComponentFixture<EntryActivation>;

  function currentEntry(): CharacterBookEntry {
    const entry = workspace.entries()[0];
    assert(entry);
    return entry;
  }

  async function createPane(
    overrides: Partial<CharacterBookEntry> = {},
  ): Promise<EntryActivation> {
    workspace.activeProject.set(
      projectOf([{ ...createEmptyEntry(0), ...overrides }], { id: 'activation-project', title: 'Activation' }),
    );
    fixture = TestBed.createComponent(EntryActivation);
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

  /** Chip instances of one chip listbox, addressed by its aria-label. */
  function chipsOf(listboxLabel: string): MatChipOption[] {
    const listbox = fixture.debugElement
      .queryAll(By.css('mat-chip-listbox'))
      .find((el) => el.nativeElement.getAttribute('aria-label') === listboxLabel);
    assert(listbox);
    return listbox
      .queryAll(By.css('mat-chip-option'))
      .map((chip) => chip.componentInstance as MatChipOption);
  }

  /** The chip of the generation-type listbox for the given ST trigger. */
  function triggerChip(value: StTrigger): MatChipOption {
    const chip = chipsOf('Generation type triggers')[
      ST_TRIGGER_OPTIONS.findIndex((option) => option.value === value)
    ];
    assert(chip);
    return chip;
  }

  beforeEach(async () => {
    TestBed.configureTestingModule({ imports: [EntryActivation] });
    workspace = TestBed.inject(WorkspaceService);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('seeds the form from the extensions and the character filter', async () => {
    const component = await createPane({
      extensions: {
        ...createEmptyEntry(0).extensions,
        scan_depth: 5,
        probability: 42,
        automation_id: 'qr-1',
        character_filter: { is_exclude: false, names: ['Saber', 'Rin'], tags: [] },
      },
    });

    expect(component['model']()).toEqual({
      scanDepth: 5,
      probability: 42,
      automationId: 'qr-1',
      filterNames: 'Saber, Rin',
    });
  });

  it('writes scan depth, automation id and a defaulted probability back', async () => {
    const component = await createPane();

    // A cleared probability falls back to the ST default of 100%.
    component['model'].set({
      scanDepth: 3,
      probability: null,
      automationId: 'qr-9',
      filterNames: '',
    });
    await fixture.whenStable();

    const ext = currentEntry().extensions;
    expect(ext['scan_depth']).toBe(3);
    expect(ext['probability']).toBe(100);
    expect(ext['automation_id']).toBe('qr-9');
    // Writing any field materializes the lazy character filter object.
    expect(ext['character_filter']).toEqual({ is_exclude: false, names: [], tags: [] });
    // Unrelated extension data survives the patch.
    expect(ext['ignore_budget']).toBe(false);
  });

  it('flags a negative scan depth and probabilities outside 0–100%', async () => {
    const component = await createPane();
    const form = component['activationForm'];

    component['model'].set({
      scanDepth: -1,
      probability: 150,
      automationId: '',
      filterNames: '',
    });
    await fixture.whenStable();
    expect(form.scanDepth().errors()[0]?.message).toBe('Scan depth cannot be negative');
    expect(form.probability().errors()[0]?.message).toBe('Probability cannot be above 100%');

    component['model'].set({
      scanDepth: 0,
      probability: -5,
      automationId: '',
      filterNames: '',
    });
    await fixture.whenStable();
    expect(form.scanDepth().errors()).toEqual([]);
    expect(form.probability().errors()[0]?.message).toBe('Probability cannot be below 0%');

    component['model'].set({ scanDepth: 0, probability: 100, automationId: '', filterNames: '' });
    await fixture.whenStable();
    expect(form.probability().errors()).toEqual([]);
  });

  it('parses the filter-names text and keeps the stored tags', async () => {
    const component = await createPane({
      extensions: {
        ...createEmptyEntry(0).extensions,
        character_filter: { is_exclude: false, names: ['Saber'], tags: ['noble'] },
      },
    });

    component['model'].set({
      scanDepth: null,
      probability: 100,
      automationId: '',
      filterNames: ' Rin , Saber ,  Rin ',
    });
    await fixture.whenStable();

    // Comma text becomes a trimmed, de-duplicated name list; tags survive.
    expect(currentEntry().extensions['character_filter']).toEqual({
      is_exclude: false,
      names: ['Rin', 'Saber'],
      tags: ['noble'],
    });
  });

  it('creates the character filter from typed text when none is stored', async () => {
    await createPane();
    const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
      'input[placeholder="e.g. Saber, Rin"]',
    );
    assert(input);

    input.value = 'Rin, Saber';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();

    expect(currentEntry().extensions['character_filter']).toEqual({
      is_exclude: false,
      names: ['Rin', 'Saber'],
      tags: [],
    });
  });

  it('toggles the Case Sensitive chip and disables it while Constant', async () => {
    await createPane();
    const [caseChip] = chipsOf('Execution modifiers');
    assert(caseChip);

    caseChip.toggleSelected(true);
    rebind();
    expect(currentEntry().case_sensitive).toBe(true);

    // The stored state feeds back into the chip selection.
    const [selectedChip] = chipsOf('Execution modifiers');
    assert(selectedChip);
    expect(selectedChip.selected).toBe(true);

    // While the entry is constant, keys are not scanned: the chip locks.
    fixture.componentRef.setInput('entry', { ...currentEntry(), constant: true });
    fixture.detectChanges();
    expect(fixture.componentInstance['isConstant']()).toBe(true);
    const [lockedChip] = chipsOf('Execution modifiers');
    assert(lockedChip);
    expect(lockedChip.disabled).toBe(true);
  });

  it('toggles Ignore Budget into the extensions', async () => {
    await createPane();
    const [, budgetChip] = chipsOf('Execution modifiers');
    assert(budgetChip);

    budgetChip.toggleSelected(true);
    rebind();

    expect(currentEntry().extensions['ignore_budget']).toBe(true);
  });

  it('marks the stored generation types as selected on mount', async () => {
    await createPane({
      extensions: { ...createEmptyEntry(0).extensions, triggers: ['quiet'] },
    });

    const selected = chipsOf('Generation type triggers').map((c) => c.selected);
    expect(selected).toEqual([false, false, false, false, false, true]);
  });

  it('builds the generation-type filter in canonical ST order and shrinks it again', async () => {
    await createPane();

    triggerChip('normal').toggleSelected(true);
    rebind();
    expect(currentEntry().extensions['triggers']).toEqual(['normal']);

    triggerChip('swipe').toggleSelected(true);
    rebind();
    expect(currentEntry().extensions['triggers']).toEqual(['normal', 'swipe']);

    // Deselecting the first chip keeps the remaining one.
    triggerChip('normal').toggleSelected(true);
    rebind();
    expect(currentEntry().extensions['triggers']).toEqual(['swipe']);
  });

  it('flips the exclude chip, inverts the hint and preserves the filter', async () => {
    await createPane({
      extensions: {
        ...createEmptyEntry(0).extensions,
        character_filter: { is_exclude: false, names: ['Saber'], tags: ['noble'] },
      },
    });
    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('Activates only for these character names');

    const [excludeChip] = chipsOf('Character filter mode');
    assert(excludeChip);
    excludeChip.toggleSelected(true);
    rebind();

    expect(currentEntry().extensions['character_filter']).toEqual({
      is_exclude: true,
      names: ['Saber'],
      tags: ['noble'],
    });
    expect(element.textContent).toContain(
      'Activates for every character except these names',
    );
  });
});
