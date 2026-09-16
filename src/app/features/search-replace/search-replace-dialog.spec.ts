import { TestBed } from '@angular/core/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { SearchReplaceDialog } from './search-replace-dialog';
import {
  CharacterBookEntry,
  createEmptyEntry,
  ProjectWorkspace,
} from '../../core/models/lorebook.model';
import { WorkspaceService } from '../../core/services/workspace.service';

/** Builds an entry with sensible defaults for search tests. */
function entry(id: number, overrides: Partial<CharacterBookEntry> = {}): CharacterBookEntry {
  return { ...createEmptyEntry(id), ...overrides };
}

function projectOf(entries: CharacterBookEntry[]): ProjectWorkspace {
  return {
    id: 'test-project',
    title: 'Test',
    createdAt: 1,
    updatedAt: 1,
    targetType: 'standalone_lorebook',
    activeBook: { name: 'Test', extensions: {}, entries },
    headCommitId: null,
    commits: [],
  };
}

describe('SearchReplaceDialog', () => {
  let workspace: WorkspaceService;
  let closeSpy: ReturnType<typeof vi.fn>;

  async function createDialog(_activeEntryId: number | null = null): Promise<SearchReplaceDialog> {
    const fixture = TestBed.createComponent(SearchReplaceDialog);
    await fixture.whenStable();
    return fixture.componentInstance;
  }

  /** Types into the (private) form model and returns the dialog for chaining. */
  function typeIn(dialog: SearchReplaceDialog, query: string, replacement: string): void {
    dialog['model'].set({ query, replacement });
  }

  beforeEach(async () => {
    closeSpy = vi.fn();
    TestBed.configureTestingModule({
      imports: [SearchReplaceDialog],
      providers: [
        provideAnimationsAsync(),
        { provide: MAT_DIALOG_DATA, useValue: { activeEntryId: 1 } },
        { provide: MatDialogRef, useValue: { close: closeSpy } },
        { provide: MatSnackBar, useValue: { open: vi.fn() } },
      ],
    });
    workspace = TestBed.inject(WorkspaceService);
    workspace.activeProject.set(
      projectOf([
        entry(0, {
          keys: ['saber'],
          secondary_keys: ['artoria', 'saber'],
          content: 'Saber is silent about the Grail.',
          comment: 'Saber',
        }),
        entry(1, {
          keys: ['rin'],
          secondary_keys: ['tohsaka'],
          content: 'Rin studies magecraft. Rin is busy.',
          comment: 'Rin',
        }),
      ]),
    );
    // Allow the service's async init() to settle before assertions.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('finds matches in content, primary and secondary keys', async () => {
    const dialog = await createDialog();
    typeIn(dialog, 'saber', 'SHIROU');

    const rows = dialog['rows']();
    expect(rows).toHaveLength(1);
    assert(rows[0]);
    expect(rows[0].hits.content).toBe(1);
    // One primary + one secondary key hit are both counted.
    expect(rows[0].hits.keys).toBe(2);
    expect(dialog['totalHits']()).toBe(3);
  });

  it('replaces secondary key hits, not just primary keys', async () => {
    const dialog = await createDialog();
    typeIn(dialog, 'saber', 'artoria pendragon');
    await dialog['apply']();

    const updated = workspace.entries().find((e) => e.id === 0);
    assert(updated);
    expect(updated.keys).toEqual(['artoria pendragon']);
    expect(updated.secondary_keys).toEqual(['artoria', 'artoria pendragon']);
  });

  it('keeps $ patterns in the replacement literal (non-regex mode)', async () => {
    const dialog = await createDialog();
    typeIn(dialog, 'Saber', 'Saber$&');
    await dialog['apply']();

    const updated = workspace.entries().find((e) => e.id === 0);
    assert(updated);
    // Regression: String.replace used to expand $& into the match itself.
    expect(updated.content).toBe('Saber$& is silent about the Grail.');
  });

  it('expands $1 capture groups in regex mode', async () => {
    const dialog = await createDialog();
    dialog['regexMode'].set(true);
    typeIn(dialog, '(Rin)', '$1 Tohsaka');
    await dialog['apply']();

    const updated = workspace.entries().find((e) => e.id === 1);
    assert(updated);
    expect(updated.content).toBe('Rin Tohsaka studies magecraft. Rin Tohsaka is busy.');
  });

  it('limits the search to the active entry when scoped', async () => {
    const dialog = await createDialog();
    dialog['scopeActive'].set(true);
    typeIn(dialog, 'a', 'b');

    const ids = dialog['rows']().map((row) => row.entryId);
    expect(ids).toEqual([1]);
  });

  it('skips entries excluded from the replace run', async () => {
    const dialog = await createDialog();
    typeIn(dialog, 'rin', 'rin-tohsaka');
    dialog['toggleExcluded'](1, false);
    await dialog['apply']();

    const updated = workspace.entries().find((e) => e.id === 1);
    assert(updated);
    expect(updated.content).toBe('Rin studies magecraft. Rin is busy.');
  });

  it('reports an invalid regex instead of crashing', async () => {
    const dialog = await createDialog();
    dialog['regexMode'].set(true);
    typeIn(dialog, '([unclosed', 'x');

    expect(dialog['pattern']()).toBeNull();
    expect(dialog['patternError']()).toBe('Invalid regular expression');
    expect(dialog['rows']()).toEqual([]);
  });

  it('matches case-insensitively by default and respects match-case', async () => {
    const dialog = await createDialog();
    typeIn(dialog, 'saber', 'x');
    expect(dialog['totalHits']()).toBe(3);

    dialog['matchCase'].set(true);
    expect(dialog['totalHits']()).toBe(2); // keys only; content has "Saber"
  });

  it('reports zero rows for an empty query', async () => {
    const dialog = await createDialog();
    expect(dialog['rows']()).toEqual([]);
    expect(dialog['patternError']()).toBeNull();
  });
});
