import { TestBed } from '@angular/core/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { createEmptyEntry } from '../../../core/models/lorebook.model';
import { WorkspaceService } from '../../../core/services/workspace.service';
import { EntryFields } from './entry-fields';

/**
 * Smoke tests for the editor composition: the five section components mount
 * (which also exercises the `EntryUpdatesService` wiring) and edits reach the
 * WorkspaceService. The service itself is stubbed so no project is needed.
 */
describe('EntryFields', () => {
  const updateEntry = vi.fn();

  beforeEach(async () => {
    updateEntry.mockClear();
    await TestBed.configureTestingModule({
      imports: [EntryFields],
      providers: [provideAnimationsAsync()],
    })
      .overrideProvider(WorkspaceService, { useValue: { updateEntry } })
      .compileComponents();
  });

  function createFields() {
    const fixture = TestBed.createComponent(EntryFields);
    const entry = createEmptyEntry(1);
    entry.keys = ['rin'];
    fixture.componentRef.setInput('entry', entry);
    return fixture;
  }

  it('renders the five editor sections bound to the entry', async () => {
    const fixture = createFields();
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('app-entry-metadata')).toBeTruthy();
    expect(el.querySelector('app-entry-control-strip')).toBeTruthy();
    expect(el.querySelector('app-entry-keys')).toBeTruthy();
    expect(el.querySelector('app-entry-content-field')).toBeTruthy();
    expect(el.querySelector('app-entry-advanced-panel')).toBeTruthy();
    expect(el.textContent).toContain('rin');
  });

  it('patches the entry through the WorkspaceService on edit', async () => {
    const fixture = createFields();
    await fixture.whenStable();

    const nameInput = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
      'app-entry-metadata input',
    )!;
    nameInput.value = 'Rin Tohsaka';
    nameInput.dispatchEvent(new Event('input'));
    await fixture.whenStable();

    expect(updateEntry).toHaveBeenCalledWith(1, { comment: 'Rin Tohsaka' });
  });
});
