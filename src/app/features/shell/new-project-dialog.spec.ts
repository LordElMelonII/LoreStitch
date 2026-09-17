import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialogRef } from '@angular/material/dialog';
import { NewProjectDialog } from './new-project-dialog';

describe('NewProjectDialog', () => {
  let close: ReturnType<typeof vi.fn>;
  let fixture: ComponentFixture<NewProjectDialog>;

  async function createDialog(): Promise<NewProjectDialog> {
    TestBed.configureTestingModule({
      imports: [NewProjectDialog],
      providers: [{ provide: MatDialogRef, useValue: { close } }],
    });
    fixture = TestBed.createComponent(NewProjectDialog);
    await fixture.whenStable();
    return fixture.componentInstance;
  }

  /** Types a title into the form field the way a user would. */
  async function typeTitle(value: string): Promise<HTMLInputElement> {
    const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
      'input[aria-label="Project title"]',
    );
    assert(input);
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    return input;
  }

  function actionButton(label: string): HTMLButtonElement {
    const match = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
        'mat-dialog-actions button',
      ),
    ].find((b) => b.textContent?.trim() === label);
    assert(match);
    return match;
  }

  function errorText(): string {
    return (
      (fixture.nativeElement as HTMLElement).querySelector('mat-error')?.textContent?.trim() ?? ''
    );
  }

  beforeEach(() => {
    close = vi.fn();
  });

  it('blocks an empty title and surfaces the required error on submit attempt', async () => {
    await createDialog();
    fixture.detectChanges();
    expect(actionButton('Create Project').disabled).toBe(true);

    // Pressing Enter runs submit(), which marks the field touched but must
    // not close the dialog while the model is invalid.
    const input = await typeTitle('');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(close).not.toHaveBeenCalled();
    expect(errorText()).toBe('A project title is required');
  });

  it('treats a whitespace-only title as missing', async () => {
    const dialog = await createDialog();
    await typeTitle('   ');
    fixture.detectChanges();

    expect(dialog['projectForm']().invalid()).toBe(true);
    expect(actionButton('Create Project').disabled).toBe(true);
    expect(close).not.toHaveBeenCalled();
  });

  it('closes with the trimmed title on a valid submit', async () => {
    const dialog = await createDialog();
    await typeTitle('  Fuyuki City  ');
    fixture.detectChanges();
    expect(dialog['projectForm']().invalid()).toBe(false);
    expect(actionButton('Create Project').disabled).toBe(false);

    actionButton('Create Project').click();
    await fixture.whenStable();

    expect(close).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledWith({ title: 'Fuyuki City' });
  });

  it('enforces the 80-character title limit', async () => {
    const dialog = await createDialog();
    const input = await typeTitle('F'.repeat(81));
    fixture.detectChanges();
    expect(dialog['projectForm']().invalid()).toBe(true);

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(close).not.toHaveBeenCalled();
    expect(errorText()).toBe('Keep the title under 80 characters');

    // Exactly 80 characters passes and closes with the value as typed.
    await typeTitle('F'.repeat(80));
    fixture.detectChanges();
    expect(actionButton('Create Project').disabled).toBe(false);
    actionButton('Create Project').click();
    await fixture.whenStable();

    expect(close).toHaveBeenCalledWith({ title: 'F'.repeat(80) });
  });

  it('closes with null when cancelled', async () => {
    await createDialog();
    fixture.detectChanges();

    actionButton('Cancel').click();

    expect(close).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledWith(null);
  });
});
