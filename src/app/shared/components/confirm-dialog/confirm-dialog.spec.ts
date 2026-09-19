import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { ConfirmDialog } from './confirm-dialog';
import { ConfirmDialogData } from './confirm-dialog.model';

describe('ConfirmDialog', () => {
  let close: ReturnType<typeof vi.fn>;
  let fixture: ComponentFixture<ConfirmDialog>;

  function createDialog(data: ConfirmDialogData): void {
    TestBed.configureTestingModule({
      imports: [ConfirmDialog],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: { close } },
      ],
    });
    fixture = TestBed.createComponent(ConfirmDialog);
    fixture.detectChanges();
  }

  /** The dialog action button carrying the exact trimmed label. */
  function button(label: string): HTMLButtonElement {
    const match = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
        'mat-dialog-actions button',
      ),
    ].find((b) => b.textContent?.trim() === label);
    assert(match);
    return match;
  }

  beforeEach(() => {
    close = vi.fn();
  });

  it('renders the title and message from the dialog data', () => {
    createDialog({ title: 'Delete entry', message: 'This cannot be undone.' });

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.title')?.textContent).toContain('Delete entry');
    expect(el.querySelector('.message')?.textContent).toContain('This cannot be undone.');
  });

  it('falls back to "Confirm" and honors a custom confirm label', () => {
    createDialog({ title: 'Rebuild index', message: 'All caches are dropped.' });

    expect(button('Confirm')).toBeTruthy();
    expect(button('Cancel')).toBeTruthy();

    TestBed.resetTestingModule();
    createDialog({
      title: 'Discard draft',
      message: 'Uncommitted changes are lost.',
      confirmLabel: 'Discard',
    });

    expect(button('Discard')).toBeTruthy();
  });

  it('closes with false when cancelled', () => {
    createDialog({ title: 'Delete entry', message: 'Sure?' });

    button('Cancel').click();

    expect(close).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledWith(false);
  });

  it('closes with true when confirmed', () => {
    createDialog({
      title: 'Delete entry',
      message: 'Sure?',
      confirmLabel: 'Delete',
      danger: true,
    });

    button('Delete').click();

    expect(close).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledWith(true);
  });

  it('marks destructive confirmations with the warning icon and danger styling', () => {
    createDialog({ title: 'Delete entry', message: 'Sure?', danger: true });

    const el = fixture.nativeElement as HTMLElement;
    const icon = el.querySelector('mat-icon.danger');
    expect(icon?.textContent?.trim()).toBe('warning');
    expect(button('Confirm').className).toContain('danger-btn');
  });

  it('keeps neutral confirmations on the help icon without danger styling', () => {
    createDialog({ title: 'Merge books', message: 'Combine both books?' });

    const el = fixture.nativeElement as HTMLElement;
    const icon = el.querySelector('mat-icon');
    expect(icon?.classList.contains('danger')).toBe(false);
    expect(icon?.textContent?.trim()).toBe('help');
    expect(button('Confirm').classList.contains('danger-btn')).toBe(false);
  });
});
