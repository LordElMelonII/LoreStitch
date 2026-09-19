import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialogRef } from '@angular/material/dialog';
import {
  CharacterBookEntry,
  createEmptyEntry,
} from '../../../core/models/lorebook.model';
import { WorkspaceService } from '../../../core/services/workspace.service';
import { TokenInspectorDialog } from './token-inspector-dialog';
import { projectOf } from '../../../../testing/project-fixtures';

/** Builds an entry with sensible defaults for inspector tests. */
function entry(id: number, overrides: Partial<CharacterBookEntry> = {}): CharacterBookEntry {
  return { ...createEmptyEntry(id), ...overrides };
}

/**
 * An enabled constant entry whose estimate is exact: the estimator assumes
 * ~4 latin characters per token.
 */
function constantEntry(id: number, comment: string, chars: number): CharacterBookEntry {
  return entry(id, { comment, constant: true, content: 'a'.repeat(chars) });
}

/** Seeds the inspector workspace, optionally with a token budget. */
function seededProject(entries: CharacterBookEntry[], tokenBudget?: number) {
  return projectOf(entries, {
    id: 'inspector-project',
    title: 'Inspector',
    ...(tokenBudget === undefined ? {} : { tokenBudget }),
  });
}

describe('TokenInspectorDialog', () => {
  let workspace: WorkspaceService;
  let close: ReturnType<typeof vi.fn> = vi.fn();
  let fixture: ComponentFixture<TokenInspectorDialog>;

  async function createDialog(
    entries: CharacterBookEntry[],
    tokenBudget?: number,
  ): Promise<TokenInspectorDialog> {
    close = vi.fn();
    TestBed.configureTestingModule({
      imports: [TokenInspectorDialog],
      providers: [{ provide: MatDialogRef, useValue: { close } }],
    });
    workspace = TestBed.inject(WorkspaceService);
    workspace.activeProject.set(seededProject(entries, tokenBudget));
    // Allow the workspace's async init() to settle before mounting.
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture = TestBed.createComponent(TokenInspectorDialog);
    await fixture.whenStable();
    return fixture.componentInstance;
  }

  function render(): HTMLElement {
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('breaks the footprint down per enabled constant entry, heaviest first', async () => {
    await createDialog(
      [
        constantEntry(0, 'Light', 40), // ~10 tokens
        constantEntry(1, 'Heavy', 80), // ~20 tokens
        // Disabled constants and keyed entries never cost anything upfront.
        entry(2, {
          comment: 'Off',
          constant: true,
          enabled: false,
          content: 'z'.repeat(400),
        }),
        entry(3, { comment: 'Keyed', constant: false, content: 'z'.repeat(400) }),
      ],
      45,
    );
    const el = render();

    const rows = [...el.querySelectorAll('.entry-row')];
    expect(rows.map((r) => r.querySelector('.entry-title')?.textContent?.trim())).toEqual([
      'Heavy',
      'Light',
    ]);
    expect(rows.map((r) => r.querySelector('.entry-tokens')?.textContent?.trim())).toEqual([
      '~20',
      '~10',
    ]);
    expect(el.querySelector('.total')?.textContent).toContain('~30');
    expect(el.querySelector('.total-caption')?.textContent).toContain('across 2 constant entries');
  });

  it('shows the budget meter and usage caption when a budget is set', async () => {
    const dialog = await createDialog(
      [constantEntry(0, 'Light', 40), constantEntry(1, 'Heavy', 80)],
      45,
    );
    const el = render();

    expect(el.querySelector('.budget-caption')?.textContent).toContain(
      '67% of the 45 token budget used by constant entries',
    );
    const bar = el.querySelector('mat-progress-bar');
    expect(bar?.getAttribute('aria-label')).toBe('Budget usage 67%');
    expect(dialog['meterValue']()).toBeCloseTo((30 / 45) * 100, 1);
    expect(el.querySelector('.warn-icon')).toBeNull();
  });

  it('flags over-budget books and clamps the meter at full', async () => {
    const dialog = await createDialog(
      [constantEntry(0, 'Light', 40), constantEntry(1, 'Heavy', 80)],
      25,
    );
    const el = render();

    expect(el.querySelector('.summary')?.className).toContain('over-budget');
    expect(el.querySelector('.budget-caption')?.textContent).toContain(
      'Over budget by ~5 tokens',
    );
    expect(el.querySelector('mat-progress-bar')?.getAttribute('aria-label')).toBe(
      'Budget usage 120%',
    );
    // The 120% fill is clamped so the bar renders full instead of overflowing.
    expect(dialog['meterValue']()).toBe(100);
    expect(el.querySelector('.warn-icon')).toBeTruthy();
  });

  it('shows the empty state when nothing is constant', async () => {
    await createDialog([entry(0, { comment: 'Keyed' })], 100);
    const el = render();

    expect(el.querySelectorAll('.entry-row')).toHaveLength(0);
    expect(el.querySelector('.empty-state')?.textContent).toContain('No constant entries');
  });

  it('renders nothing without an open project and reads a zero meter', async () => {
    TestBed.configureTestingModule({
      imports: [TokenInspectorDialog],
      providers: [{ provide: MatDialogRef, useValue: { close } }],
    });
    workspace = TestBed.inject(WorkspaceService);
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture = TestBed.createComponent(TokenInspectorDialog);
    await fixture.whenStable();
    const el = render();

    expect(el.querySelector('.summary')).toBeNull();
    expect(fixture.componentInstance['meterValue']()).toBe(0);

    // The Done button still closes the (empty) dialog.
    const done = [...el.querySelectorAll<HTMLButtonElement>('mat-dialog-actions button')].find(
      (b) => b.textContent?.trim() === 'Done',
    );
    assert(done);
    done.click();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('edits the budget inline and persists it on the working book', async () => {
    await createDialog([constantEntry(0, 'Light', 40), constantEntry(1, 'Heavy', 80)], 45);
    const el = render();
    const input = el.querySelector<HTMLInputElement>(
      'input[aria-label="Token budget for this lorebook"]',
    );
    assert(input);
    expect(input.value).toBe('45');

    input.value = '80';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(workspace.activeProject()?.activeBook.token_budget).toBe(80);

    // Clearing the field removes the budget entirely and flips the caption.
    input.value = '';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(workspace.activeProject()?.activeBook.token_budget).toBeUndefined();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.budget-caption')?.textContent,
    ).toContain('No budget set');

    // Nonsense values (negative) are dropped instead of written.
    input.value = '-5';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(workspace.activeProject()?.activeBook.token_budget).toBeUndefined();
  });

  it('opens the clicked entry in the workspace and closes the dialog', async () => {
    await createDialog([constantEntry(0, 'Light', 40), constantEntry(1, 'Heavy', 80)], 45);
    const el = render();

    const heavy = [...el.querySelectorAll('.entry-row')].find((r) =>
      r.textContent?.includes('Heavy'),
    );
    assert(heavy);
    (heavy as HTMLElement).click();
    await fixture.whenStable();

    expect(workspace.activeTabId()).toBe(1);
    expect(workspace.openTabEntryIds()).toContain(1);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
