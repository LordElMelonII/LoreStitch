import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_BOTTOM_SHEET_DATA, MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { type BookDefect } from '../../../core/models/book-schema';
import { type BookRepair, type RepairChange } from '../../../core/models/book-repair';
import { BookRepairDialog } from './book-repair-dialog';
import { type BookRepairDialogData } from './book-repair-dialog.model';

/** A plan covering every RepairChangeKind (the checkpoint mock's story). */
function repairFixture(): BookRepair {
  const changes: RepairChange[] = [
    { kind: 'coerce-id', entryTitle: 'Tavern', from: '"7"', to: '7' },
    { kind: 'reassign-id', entryTitle: 'River dock', from: '2', to: '4' },
    { kind: 'default-insertion-order', entryTitle: 'River dock', from: '∞', to: '100' },
    { kind: 'unset-priority', entryTitle: 'Old forest', from: '∞', to: '(unset)' },
  ];
  return { book: { name: 'x', extensions: {}, entries: [] }, changes };
}

function defectsFixture(): BookDefect[] {
  return [
    { kind: 'entry-keys-not-string-array', entryId: null, entryTitle: 'Gate house' },
    { kind: 'entry-content-not-string', entryId: null, entryTitle: 'River dock' },
  ];
}

describe('BookRepairDialog', () => {
  let close: ReturnType<typeof vi.fn>;
  let fixture: ComponentFixture<BookRepairDialog>;

  function createDialog(
    data: BookRepairDialogData,
    sheet = false,
  ): void {
    TestBed.configureTestingModule({
      imports: [BookRepairDialog],
      providers: sheet
        ? [
            { provide: MAT_BOTTOM_SHEET_DATA, useValue: data },
            { provide: MatBottomSheetRef, useValue: { dismiss: close } },
          ]
        : [
            { provide: MAT_DIALOG_DATA, useValue: data },
            { provide: MatDialogRef, useValue: { close } },
          ],
    });
    fixture = TestBed.createComponent(BookRepairDialog);
    fixture.detectChanges();
  }

  /** The action button carrying the exact trimmed label. */
  function button(label: string): HTMLButtonElement {
    const match = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
        '.actions button',
      ),
    ].find((b) => b.textContent?.trim() === label);
    assert(match);
    return match;
  }

  function importRepair(): BookRepairDialogData {
    return {
      context: 'import',
      repair: repairFixture(),
      defects: [],
      bookTitle: 'Fuyuki Grail War — community supplement',
    };
  }

  beforeEach(() => {
    close = vi.fn();
  });

  it('renders the change list with kind labels and from → to values', () => {
    createDialog(importRepair());

    const el = fixture.nativeElement as HTMLElement;
    const rows = [...el.querySelectorAll('.change')];
    expect(rows).toHaveLength(4);
    const [coerced, reassigned, order, priority] = rows;
    assert(coerced);
    assert(reassigned);
    assert(order);
    assert(priority);
    expect(coerced.querySelector('.change-title')?.textContent?.trim()).toBe('Tavern');
    expect(coerced.querySelector('.change-kind')?.textContent?.trim()).toBe('Id corrected');
    expect(coerced.querySelector('.change-detail')?.textContent).toContain('id');
    expect(coerced.querySelector('.val.from')?.textContent?.trim()).toBe('"7"');
    expect(coerced.querySelector('.val.to')?.textContent?.trim()).toBe('7');
    expect(reassigned.querySelector('.change-kind')?.textContent?.trim()).toBe('Id renumbered');
    expect(order.querySelector('.change-kind')?.textContent?.trim()).toBe('Insertion order set');
    expect(order.querySelector('.change-detail')?.textContent).toContain('insertion order');
    expect(order.querySelector('.val.from')?.textContent?.trim()).toBe('∞');
    expect(order.querySelector('.val.to')?.textContent?.trim()).toBe('100');
    expect(priority.querySelector('.change-kind')?.textContent?.trim()).toBe('Priority unset');
    expect(priority.querySelector('.change-detail')?.textContent).toContain('priority');
    expect(priority.querySelector('.val.to')?.textContent?.trim()).toBe('(unset)');
  });

  it('uses the approved import copy with the plural count', () => {
    createDialog(importRepair());

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.title')?.textContent).toContain('Fix 4 issues before importing?');
    expect(el.querySelector('.message')?.textContent).toContain(
      'every entry, key and vendor field rides along verbatim',
    );
    expect(button('Fix 4 issues & import')).toBeTruthy();
    expect(button('Import as-is')).toBeTruthy();
  });

  it('singularizes the count for a single change', () => {
    createDialog({
      context: 'import',
      repair: {
        book: { name: 'x', extensions: {}, entries: [] },
        changes: [{ kind: 'coerce-id', entryTitle: 'Tavern', from: '"7"', to: '7' }],
      },
      defects: [],
      bookTitle: 'Solo',
    });

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.title')?.textContent).toContain('Fix 1 issue before importing?');
    expect(button('Fix 1 issue & import')).toBeTruthy();
  });

  it('uses the approved export copy and labels', () => {
    createDialog({ ...importRepair(), context: 'export' });

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.title')?.textContent).toContain('Fix 4 issues before exporting?');
    expect(el.querySelector('.message')?.textContent).toContain(
      'Fixing rewrites those fields in the workspace, then the export proceeds',
    );
    expect(button('Fix 4 issues & export')).toBeTruthy();
    expect(button('Cancel')).toBeTruthy();
  });

  it('closes truthy on the primary action and falsy on the secondary', () => {
    createDialog(importRepair());

    button('Fix 4 issues & import').click();
    expect(close).toHaveBeenCalledWith(true);

    button('Import as-is').click();
    expect(close).toHaveBeenCalledWith(false);
  });

  it('renders the block variant rows and closes falsy on Close', () => {
    createDialog({
      context: 'export',
      repair: null,
      defects: defectsFixture(),
      bookTitle: 'Fuyuki',
    });

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.title')?.textContent).toContain('This book can’t be exported yet');
    const rows = [...el.querySelectorAll('.block-row')];
    expect(rows).toHaveLength(2);
    assert(rows[0]);
    assert(rows[1]);
    expect(rows[0].textContent).toContain('Gate house');
    expect(rows[0].textContent).toContain('Keys is not a list of keywords');
    expect(rows[1].textContent).toContain('River dock');
    expect(rows[1].textContent).toContain('Content is not text');

    expect(button('Close')).toBeTruthy();
    button('Close').click();
    expect(close).toHaveBeenCalledWith(false);
  });

  it('renders "An entry" for an entry-level defect without a title and no prefix for book-level ones', () => {
    createDialog({
      context: 'export',
      repair: null,
      defects: [
        { kind: 'entry-content-not-string', entryId: null, entryTitle: null },
        { kind: 'book-entries-not-array', entryId: null, entryTitle: null },
      ],
      bookTitle: 'Fuyuki',
    });

    const rows = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll('.block-row'),
    ].map((row) => row.textContent?.trim());
    expect(rows[0]).toContain('An entry');
    expect(rows[0]).toContain('Content is not text');
    expect(rows[1]).toContain('The entries collection is malformed');
    expect(rows[1]).not.toContain('An entry');
  });

  it('names a hard-blocked snapshot source verbatim', () => {
    createDialog({
      context: 'export',
      repair: null,
      defects: defectsFixture(),
      source: 'Initial commit (7a927e3)',
      bookTitle: 'Fuyuki',
    });

    const source = fixture.nativeElement as HTMLElement;
    expect(source.querySelector('.source')?.textContent?.trim()).toBe('Initial commit (7a927e3)');
  });

  it('adapts to the bottom sheet: drag handle and stacked form', () => {
    createDialog(importRepair(), true);

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.drag-handle')).toBeTruthy();
    expect(el.querySelector('.pane')?.classList.contains('sheet')).toBe(true);
  });
});
