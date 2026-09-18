import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MAT_BOTTOM_SHEET_DATA, MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import {
  CharacterBookEntry,
  ProjectWorkspace,
  ST_LOGIC,
  ST_POSITION,
  ST_ROLE,
  createEmptyEntry,
} from '../../core/models/lorebook.model';
import { WorkspaceService } from '../../core/services/workspace.service';
import { BatchOperationsDialog } from './batch-operations-dialog';

/** Builds an entry with sensible defaults for batch tests. */
function entry(id: number, overrides: Partial<CharacterBookEntry> = {}): CharacterBookEntry {
  return { ...createEmptyEntry(id), ...overrides };
}

/** Entry carrying author tags in the LoreStitch extension namespace. */
function tagged(id: number, tags: string[]): CharacterBookEntry {
  return entry(id, {
    comment: `Entry ${id}`,
    extensions: { ...createEmptyEntry(id).extensions, lorestitch_tags: tags },
  });
}

function projectOf(entries: CharacterBookEntry[]): ProjectWorkspace {
  return {
    id: 'batch-project',
    title: 'Batch',
    createdAt: 1,
    updatedAt: 1,
    targetType: 'standalone_lorebook',
    activeBook: { name: 'Batch', extensions: {}, entries },
    headCommitId: null,
    commits: [],
  };
}

describe('BatchOperationsDialog', () => {
  let workspace: WorkspaceService;
  let snackBar: MatSnackBar;
  let close: ReturnType<typeof vi.fn> = vi.fn();
  let fixture: ComponentFixture<BatchOperationsDialog>;

  /**
   * Mounts the pane as one of its two containers would: `sheet: false`
   * (default) mirrors the centered dialog (data + MatDialogRef), `sheet: true`
   * mirrors the phone bottom sheet (sheet data token + MatBottomSheetRef and
   * no dialog ref at all).
   */
  async function createDialog(
    entryIds: number[],
    entries: CharacterBookEntry[],
    options: { sheet?: boolean; dismiss?: ReturnType<typeof vi.fn> } = {},
  ): Promise<BatchOperationsDialog> {
    close = vi.fn();
    TestBed.configureTestingModule({
      imports: [BatchOperationsDialog],
      providers: [
        {
          provide: options.sheet ? MAT_BOTTOM_SHEET_DATA : MAT_DIALOG_DATA,
          useValue: { entryIds },
        },
        ...(options.sheet
          ? [{ provide: MatBottomSheetRef, useValue: { dismiss: options.dismiss ?? vi.fn() } }]
          : [{ provide: MatDialogRef, useValue: { close } }]),
      ],
    });
    workspace = TestBed.inject(WorkspaceService);
    snackBar = TestBed.inject(MatSnackBar);
    vi.spyOn(snackBar, 'open');
    workspace.activeProject.set(projectOf(entries));
    // Allow the workspace's async init() to settle before mounting.
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture = TestBed.createComponent(BatchOperationsDialog);
    await fixture.whenStable();
    return fixture.componentInstance;
  }

  /** Clicks the toggle with the given value inside the labelled group. */
  function pickToggle(groupLabel: string, value: string): void {
    const group = fixture.debugElement.query(
      By.css(`mat-button-toggle-group[aria-label="${groupLabel}"]`),
    );
    assert(group);
    const toggle = group
      .queryAll(By.css('mat-button-toggle'))
      .find((t) => t.componentInstance.value === value);
    assert(toggle);
    const button = toggle.query(By.css('button'));
    assert(button);
    (button.nativeElement as HTMLButtonElement).click();
  }

  /** Types into a (ngModel)-bound field the way a user would. */
  async function typeInto(ariaLabel: string, value: string): Promise<void> {
    const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
      `input[aria-label="${ariaLabel}"]`,
    );
    assert(input);
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
  }

  function statusText(): string {
    return (
      (fixture.nativeElement as HTMLElement).querySelector('.affected')?.textContent?.trim() ?? ''
    );
  }

  function applyButton(): HTMLButtonElement {
    const match = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
        '.pane-footer button',
      ),
    ].find((b) => b.textContent?.includes('Apply to'));
    assert(match);
    return match;
  }

  function actionButton(label: string): HTMLButtonElement {
    const match = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
        '.pane-footer button',
      ),
    ].find((b) => b.textContent?.trim() === label);
    assert(match);
    return match;
  }

  it('idles with "No changes to apply" and a disabled Apply button', async () => {
    await createDialog([0, 1], [entry(0), entry(1)]);
    fixture.detectChanges();

    expect(
      (fixture.nativeElement as HTMLElement).querySelector('h2')?.textContent,
    ).toContain('Batch Edit 2 Entries');
    expect(statusText()).toBe('No changes to apply');
    expect(applyButton().disabled).toBe(true);
    expect(close).not.toHaveBeenCalled();
  });

  it('disables every selected entry and writes nothing else', async () => {
    await createDialog([0, 1], [entry(0, { keys: ['saber'] }), entry(1), entry(2)]);
    pickToggle('Bulk enabled state', 'disable');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(statusText()).toContain('Will update 2 of 2 entries');

    applyButton().click();
    await fixture.whenStable();

    const entries = workspace.entries();
    expect(entries.map((e) => e.enabled)).toEqual([false, false, true]);
    // Only the toggled field is written; keys and orders survive the run.
    expect(entries[0]?.keys).toEqual(['saber']);
    expect(entries[0]?.insertion_order).toBe(100);
    expect(snackBar.open).toHaveBeenCalledWith('Updated 2 entries.', 'OK', { duration: 3500 });
    expect(close).toHaveBeenCalledWith(true);
  });

  it('counts only entries the run would actually change', async () => {
    await createDialog([0, 1], [entry(0), entry(1, { enabled: false })]);
    pickToggle('Bulk enabled state', 'disable');
    await fixture.whenStable();
    fixture.detectChanges();

    // Entry 1 is already disabled, so only entry 0 counts.
    expect(statusText()).toContain('Will update 1 of 2 entries');
    expect(applyButton().textContent).toContain('Apply to 1 entry');

    applyButton().click();
    await fixture.whenStable();

    expect(workspace.entries().every((e) => !e.enabled)).toBe(true);
    expect(snackBar.open).toHaveBeenCalledWith('Updated 1 entry.', 'OK', { duration: 3500 });
    expect(close).toHaveBeenCalledWith(true);
  });

  it('shifts the insertion order of the selection by the typed amount', async () => {
    await createDialog([0, 2], [entry(0), entry(1), entry(2)]);
    pickToggle('Insertion order operation', 'shift');
    await fixture.whenStable();
    fixture.detectChanges();

    await typeInto('Order shift amount', '-30');
    expect(statusText()).toContain('Will update 2 of 2 entries');

    applyButton().click();
    await fixture.whenStable();

    expect(workspace.entries().map((e) => e.insertion_order)).toEqual([70, 100, 70]);
    expect(close).toHaveBeenCalledWith(true);
  });

  it('sanitizes a non-numeric order shift to a no-op and cancels cleanly', async () => {
    const dialog = await createDialog([0], [entry(0)]);
    pickToggle('Insertion order operation', 'shift');
    await fixture.whenStable();
    fixture.detectChanges();

    // A NaN amount falls back to 0, which is a no-op for every entry.
    dialog['orderAmount'].set(Number.NaN);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(statusText()).toBe('No changes to apply');
    expect(applyButton().disabled).toBe(true);

    // Even a forced apply refuses to write and closes with false.
    dialog['apply']();
    expect(close).toHaveBeenCalledWith(false);
    expect(workspace.entries()[0]?.insertion_order).toBe(100);

    actionButton('Cancel').click();
    expect(close).toHaveBeenCalledTimes(2);
    expect(workspace.entries()[0]?.insertion_order).toBe(100);
  });

  it('clears the per-entry case-sensitivity override back to the book default', async () => {
    await createDialog(
      [0, 1],
      [
        entry(0, { case_sensitive: true, extensions: { ...createEmptyEntry(0).extensions, case_sensitive: true } }),
        entry(1),
      ],
    );
    pickToggle('Case sensitivity operation', 'default');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(statusText()).toContain('Will update 2 of 2 entries');

    applyButton().click();
    await fixture.whenStable();

    const first = workspace.entries()[0];
    assert(first);
    expect(first.extensions['case_sensitive']).toBeNull();
    expect(close).toHaveBeenCalledWith(true);
  });

  it('adds a trimmed, de-duplicated tag draft and removes a marked tag', async () => {
    const dialog = await createDialog(
      [0, 1],
      [tagged(0, ['servant', 'saber']), tagged(1, ['master', 'servant']), tagged(2, ['artifact'])],
    );
    fixture.detectChanges();

    // Existing tags across the selection are offered for removal, sorted.
    expect(dialog['existingTags']()).toEqual(['master', 'saber', 'servant']);
    const chips = fixture.debugElement.queryAll(By.css('mat-chip-option'));
    const servant = chips.find((c) => c.nativeElement.textContent.includes('servant'));
    assert(servant);
    servant.componentInstance.toggleSelected(true);
    await fixture.whenStable();
    expect(dialog['removeTags']()).toEqual(new Set(['servant']));
    // Un-marking the chip clears the pending removal again.
    servant.componentInstance.toggleSelected(false);
    await fixture.whenStable();
    expect(dialog['removeTags']().size).toBe(0);
    servant.componentInstance.toggleSelected(true);
    await fixture.whenStable();
    expect(dialog['removeTags']()).toEqual(new Set(['servant']));

    await typeInto('Tags to add to the selected entries', '  elite , elite  ');
    expect(dialog['operations']().addTags).toEqual(['elite']);
    expect(statusText()).toContain('Will update 2 of 2 entries');

    applyButton().click();
    await fixture.whenStable();

    const entries = workspace.entries();
    expect(entries[0]?.extensions['lorestitch_tags']).toEqual(['saber', 'elite']);
    expect(entries[1]?.extensions['lorestitch_tags']).toEqual(['master', 'elite']);
    // The unselected entry keeps its tags untouched.
    expect(entries[2]?.extensions['lorestitch_tags']).toEqual(['artifact']);
    expect(close).toHaveBeenCalledWith(true);
  });

  it('switches the trigger strategy to constant and sets a scan-depth override', async () => {
    await createDialog([0, 1], [entry(0), entry(1)]);
    pickToggle('Bulk trigger strategy', 'constant');
    await fixture.whenStable();
    fixture.detectChanges();
    pickToggle('Scan depth operation', 'set');
    await fixture.whenStable();
    fixture.detectChanges();

    await typeInto('Scan depth value', '6');
    applyButton().click();
    await fixture.whenStable();

    const first = workspace.entries()[0];
    assert(first);
    expect(first.constant).toBe(true);
    expect(first.extensions['vectorized']).toBe(false);
    expect(first.extensions['scan_depth']).toBe(6);
    expect(close).toHaveBeenCalledWith(true);
  });

  it('writes the selective logic picked in the lazy mat-select', async () => {
    const dialog = await createDialog([0], [entry(0)]);
    pickToggle('Selective logic operation', 'set');
    await fixture.whenStable();
    fixture.detectChanges();

    const select = fixture.debugElement.query(By.css('mat-select'));
    assert(select);
    select.componentInstance.open();
    fixture.detectChanges();
    const andAll = [...document.querySelectorAll('mat-option')].find((o) =>
      o.textContent?.includes('AND All'),
    );
    assert(andAll);
    (andAll as HTMLElement).click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(dialog['logicValue']()).toBe(ST_LOGIC.AND_ALL);

    applyButton().click();
    await fixture.whenStable();
    expect(workspace.entries()[0]?.extensions['selectiveLogic']).toBe(ST_LOGIC.AND_ALL);
  });

  it('positions at chat depth carry the depth and role mirrors', async () => {
    const dialog = await createDialog([0], [entry(0)]);
    dialog['positionMode'].set('set');
    dialog['positionValue'].set('at_depth');
    dialog['depthValue'].set(2);
    dialog['roleValue'].set(ST_ROLE.user);
    await fixture.whenStable();
    fixture.detectChanges();

    applyButton().click();
    await fixture.whenStable();

    const first = workspace.entries()[0];
    assert(first);
    expect(first.position).toBe('at_depth');
    expect(first.extensions['position']).toBe(ST_POSITION.atDepth);
    expect(first.extensions['depth']).toBe(2);
    expect(first.extensions['role']).toBe(ST_ROLE.user);
  });

  it('names an outlet position with the trimmed outlet field', async () => {
    const dialog = await createDialog([0], [entry(0)]);
    dialog['positionMode'].set('set');
    dialog['positionValue'].set('outlet');
    await fixture.whenStable();
    fixture.detectChanges();

    await typeInto('Outlet name', '  world_state  ');
    applyButton().click();
    await fixture.whenStable();

    const first = workspace.entries()[0];
    assert(first);
    expect(first.position).toBe('outlet');
    expect(first.extensions['position']).toBe(ST_POSITION.outlet);
    expect(first.extensions['outlet_name']).toBe('world_state');
  });

  it('opens as a phone bottom sheet and dismisses through the sheet ref', async () => {
    const dismiss = vi.fn();
    await createDialog([0], [entry(0)], { sheet: true, dismiss });
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('h2')?.textContent).toContain(
      'Batch Edit 1 Entries',
    );
    expect(statusText()).toBe('No changes to apply');

    // The header close affordance routes to the sheet ref; the dialog ref is
    // absent entirely on this path.
    const closeButton = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      'button[aria-label="Close batch edit"]',
    );
    assert(closeButton);
    closeButton.click();
    expect(dismiss).toHaveBeenCalledWith(false);
    expect(close).not.toHaveBeenCalled();
  });
});
