import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MatButtonToggle } from '@angular/material/button-toggle';
import { CharacterBookEntry, createEmptyEntry } from '../../../core/models/lorebook.model';
import { WorkspaceService } from '../../../core/services/workspace.service';
import { projectOf } from '../../../../testing/project-fixtures';
import { EntryStrategyToggle } from './entry-strategy-toggle';

describe('EntryStrategyToggle', () => {
  let workspace: WorkspaceService;
  let fixture: ComponentFixture<EntryStrategyToggle>;

  function currentEntry(): CharacterBookEntry {
    const entry = workspace.entries()[0];
    assert(entry);
    return entry;
  }

  async function createToggle(
    overrides: Partial<CharacterBookEntry> = {},
  ): Promise<EntryStrategyToggle> {
    workspace.activeProject.set(
      projectOf([{ ...createEmptyEntry(0), ...overrides }], {
        id: 'strategy-project',
        title: 'Strategy',
      }),
    );
    fixture = TestBed.createComponent(EntryStrategyToggle);
    fixture.componentRef.setInput('entry', structuredClone(currentEntry()));
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture.componentInstance;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [EntryStrategyToggle],
    });
    workspace = TestBed.inject(WorkspaceService);
  });

  it('renders all three strategy options with correct labels and tooltips', async () => {
    await createToggle();
    const toggles = fixture.debugElement.queryAll(By.directive(MatButtonToggle));
    expect(toggles).toHaveLength(3);

    const values = toggles.map((t) => (t.componentInstance as MatButtonToggle).value);
    expect(values).toEqual(['normal', 'constant', 'vectorized']);

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('button[aria-label="Normal: keyword-triggered"]')).toBeTruthy();
    expect(el.querySelector('button[aria-label="Constant: always inserted"]')).toBeTruthy();
    expect(
      el.querySelector('button[aria-label="Vectorized: inserted by embedding similarity"]'),
    ).toBeTruthy();
  });

  it('selects normal by default for standard entries', async () => {
    await createToggle();
    const selected = fixture.debugElement.query(By.css('.mat-button-toggle-checked'));
    expect((selected.componentInstance as MatButtonToggle).value).toBe('normal');
  });

  it('selects constant for constant entries', async () => {
    await createToggle({ constant: true });
    const selected = fixture.debugElement.query(By.css('.mat-button-toggle-checked'));
    expect((selected.componentInstance as MatButtonToggle).value).toBe('constant');
  });

  it('selects vectorized for vectorized entries', async () => {
    await createToggle({ extensions: { vectorized: true } });
    const selected = fixture.debugElement.query(By.css('.mat-button-toggle-checked'));
    expect((selected.componentInstance as MatButtonToggle).value).toBe('vectorized');
  });

  it('dispatches state updates to workspace when switching strategy', async () => {
    await createToggle();

    const button = (label: string): HTMLButtonElement => {
      const btn = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
        `.strategy-toggle button[aria-label="${label}"]`,
      );
      assert(btn);
      return btn;
    };

    button('Constant: always inserted').click();
    await fixture.whenStable();
    expect(currentEntry().constant).toBe(true);
    expect(currentEntry().extensions['vectorized']).toBe(false);

    button('Vectorized: inserted by embedding similarity').click();
    await fixture.whenStable();
    expect(currentEntry().constant).toBe(false);
    expect(currentEntry().extensions['vectorized']).toBe(true);

    button('Normal: keyword-triggered').click();
    await fixture.whenStable();
    expect(currentEntry().constant).toBe(false);
    expect(currentEntry().extensions['vectorized']).toBe(false);
  });
});
