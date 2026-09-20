import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { SearchReplaceDialog } from './search-replace-dialog';
import { CharacterBookEntry, createEmptyEntry } from '../../core/models/lorebook.model';
import { WorkspaceService } from '../../core/services/workspace.service';
import { SEARCH_DEBOUNCE_MS } from '../../shared/constants/search';
import { projectOf } from '../../../testing/project-fixtures';

/** Builds an entry with sensible defaults for search tests. */
function entry(id: number, overrides: Partial<CharacterBookEntry> = {}): CharacterBookEntry {
  return { ...createEmptyEntry(id), ...overrides };
}

describe('SearchReplaceDialog', () => {
  let workspace: WorkspaceService;
  let closeSpy: ReturnType<typeof vi.fn>;
  let fixture: ComponentFixture<SearchReplaceDialog>;

  async function createDialog(_activeEntryId: number | null = null): Promise<SearchReplaceDialog> {
    fixture = TestBed.createComponent(SearchReplaceDialog);
    await fixture.whenStable();
    return fixture.componentInstance;
  }

  /**
   * Settles the debounced preview: `detectChanges()` flushes the component's
   * debounce-arming view effect synchronously (Angular schedules view-effect
   * flushes on its own setTimeout/rAF race, which fake-time advances cannot be
   * relied upon to fire), then the full-window advance fires the trailing edge
   * (storage.service.spec's canonical advance pattern).
   */
  async function settlePreview(): Promise<void> {
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
  }

  /** Types into the (private) form model and lets the debounced preview settle. */
  async function typeIn(
    dialog: SearchReplaceDialog,
    query: string,
    replacement: string,
  ): Promise<void> {
    dialog['model'].set({ query, replacement });
    await settlePreview();
  }

  /** Mounts the dialog and returns its fixture with the initial render flushed. */
  async function createDialogDom(): Promise<ComponentFixture<SearchReplaceDialog>> {
    fixture = TestBed.createComponent(SearchReplaceDialog);
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(async () => {
    // The debounced preview settles on fake time (storage.service.spec
    // precedent). Only the timer pair debouncedSignal uses is faked: the
    // default set also fakes microtask/rAF scheduling, which starves
    // fixture.whenStable() and hangs every component spec.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    closeSpy = vi.fn();
    TestBed.configureTestingModule({
      imports: [SearchReplaceDialog],
      providers: [
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
    await vi.advanceTimersByTimeAsync(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('finds matches in content, primary and secondary keys', async () => {
    const dialog = await createDialog();
    await typeIn(dialog, 'saber', 'SHIROU');

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
    await typeIn(dialog, 'saber', 'artoria pendragon');
    await dialog['apply']();

    const updated = workspace.entries().find((e) => e.id === 0);
    assert(updated);
    expect(updated.keys).toEqual(['artoria pendragon']);
    expect(updated.secondary_keys).toEqual(['artoria', 'artoria pendragon']);
  });

  it('keeps $ patterns in the replacement literal (non-regex mode)', async () => {
    const dialog = await createDialog();
    await typeIn(dialog, 'Saber', 'Saber$&');
    await dialog['apply']();

    const updated = workspace.entries().find((e) => e.id === 0);
    assert(updated);
    // Regression: String.replace used to expand $& into the match itself.
    expect(updated.content).toBe('Saber$& is silent about the Grail.');
  });

  it('expands $1 capture groups in regex mode', async () => {
    const dialog = await createDialog();
    dialog['regexMode'].set(true);
    await typeIn(dialog, '(Rin)', '$1 Tohsaka');
    await dialog['apply']();

    const updated = workspace.entries().find((e) => e.id === 1);
    assert(updated);
    expect(updated.content).toBe('Rin Tohsaka studies magecraft. Rin Tohsaka is busy.');
  });

  it('limits the search to the active entry when scoped', async () => {
    const dialog = await createDialog();
    dialog['scopeActive'].set(true);
    await typeIn(dialog, 'a', 'b');

    const ids = dialog['rows']().map((row) => row.entryId);
    expect(ids).toEqual([1]);
  });

  it('skips entries excluded from the replace run', async () => {
    const dialog = await createDialog();
    await typeIn(dialog, 'rin', 'rin-tohsaka');
    dialog['toggleExcluded'](1, false);
    await dialog['apply']();

    const updated = workspace.entries().find((e) => e.id === 1);
    assert(updated);
    expect(updated.content).toBe('Rin studies magecraft. Rin is busy.');
  });

  it('reports an invalid regex instead of crashing', async () => {
    const dialog = await createDialog();
    dialog['regexMode'].set(true);
    await typeIn(dialog, '([unclosed', 'x');

    expect(dialog['pattern']()).toBeNull();
    expect(dialog['patternError']()).toBe('Invalid regular expression');
    expect(dialog['rows']()).toEqual([]);
  });

  it('matches case-insensitively by default and respects match-case', async () => {
    const dialog = await createDialog();
    await typeIn(dialog, 'saber', 'x');
    expect(dialog['totalHits']()).toBe(3);

    dialog['matchCase'].set(true);
    expect(dialog['totalHits']()).toBe(2); // keys only; content has "Saber"
  });

  it('reports zero rows for an empty query', async () => {
    const dialog = await createDialog();
    expect(dialog['rows']()).toEqual([]);
    expect(dialog['patternError']()).toBeNull();
  });

  it('matches only whole words when whole-word mode is on', async () => {
    workspace.activeProject.set(
      projectOf([entry(0, { content: 'The rinsing ritual begins. Rin wins.' })]),
    );
    const dialog = await createDialog();
    await typeIn(dialog, 'rin', 'LUVIA');
    // Without the constraint the substring inside "rinsing" matches too.
    expect(dialog['totalHits']()).toBe(2);

    dialog['wholeWord'].set(true);
    const rows = dialog['rows']();
    expect(rows).toHaveLength(1);
    assert(rows[0]);
    expect(rows[0].hits.content).toBe(1); // only the standalone "Rin"
    expect(rows[0].nextContent).toBe('The rinsing ritual begins. LUVIA wins.');
  });

  it('treats regex metacharacters literally outside regex mode', async () => {
    workspace.activeProject.set(
      projectOf([entry(0, { content: 'Costs 5 credits (a.x) and aox too.' })]),
    );
    const dialog = await createDialog();
    await typeIn(dialog, 'a.x', 'gold');
    const rows = dialog['rows']();
    assert(rows[0]);
    // The dot must not act as a wildcard in literal mode.
    expect(rows[0].hits.content).toBe(1);
    expect(rows[0].nextContent).toBe('Costs 5 credits (gold) and aox too.');

    // The same query as a regex wildcards over the middle character.
    dialog['regexMode'].set(true);
    const regexRows = dialog['rows']();
    assert(regexRows[0]);
    expect(regexRows[0].hits.content).toBe(2);
  });

  it('excludes key hits from preview and write when the keys field is off', async () => {
    const dialog = await createDialog();
    await typeIn(dialog, 'saber', 'artoria');
    dialog['inKeys'].set(false);

    const rows = dialog['rows']();
    assert(rows[0]);
    expect(rows[0].hits.keys).toBe(0);
    expect(rows[0].hits.content).toBe(1);
    expect(dialog['totalHits']()).toBe(1);

    await dialog['apply']();
    const updated = workspace.entries().find((e) => e.id === 0);
    assert(updated);
    expect(updated.keys).toEqual(['saber']); // keys untouched
    expect(updated.content).toBe('artoria is silent about the Grail.');
  });

  it('searches and rewrites entry names only when the names field is on', async () => {
    const dialog = await createDialog();
    await typeIn(dialog, 'saber', 'artoria');
    // Names are opt-in: the comment hit is neither counted nor rewritten.
    expect(dialog['totalHits']()).toBe(3);

    dialog['inNames'].set(true);
    expect(dialog['totalHits']()).toBe(4);
    await dialog['apply']();

    const updated = workspace.entries().find((e) => e.id === 0);
    assert(updated);
    expect(updated.comment).toBe('artoria');
    expect(updated.content).toBe('artoria is silent about the Grail.');
  });

  it('resolves truthy and reports the tally through the snackbar on success', async () => {
    const dialog = await createDialog();
    await typeIn(dialog, 'saber', 'artoria pendragon');
    await dialog['apply']();

    expect(closeSpy).toHaveBeenCalledWith(true);
    expect(TestBed.inject(MatSnackBar).open).toHaveBeenCalledWith(
      'Replaced 3 occurrences across 1 entry',
      'OK',
      { duration: 4000 },
    );
  });

  it('stays inert when apply runs with nothing to replace', async () => {
    const dialog = await createDialog();
    // Empty query: no preview rows, nothing eligible anywhere.
    await dialog['apply']();

    expect(closeSpy).toHaveBeenCalledWith(false);
    expect(TestBed.inject(MatSnackBar).open).toHaveBeenCalledWith(
      'Replaced 0 occurrences across 0 entries',
      'OK',
      { duration: 4000 },
    );
    const untouched = workspace.entries().find((e) => e.id === 0);
    assert(untouched);
    expect(untouched.content).toBe('Saber is silent about the Grail.');
  });

  it('keeps the preview empty until the debounce settles', async () => {
    const dialog = await createDialog();
    dialog['model'].set({ query: 'saber', replacement: 'x' });
    // Flush the component so the debounce timer is armed, without settling it.
    fixture.detectChanges();

    expect(dialog['query']()).toBe('saber'); // the input is immediate
    expect(dialog['rows']()).toEqual([]);
    expect(dialog['totalHits']()).toBe(0);

    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS - 1);
    expect(dialog['rows']()).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    expect(dialog['rows']()).toHaveLength(1);
    expect(dialog['totalHits']()).toBe(3);
  });

  it('flags an invalid regex immediately while the preview still lags behind', async () => {
    const dialog = await createDialog();
    dialog['regexMode'].set(true);
    await typeIn(dialog, 'saber', 'x');
    expect(dialog['rows']()).toHaveLength(1);

    dialog['model'].set({ query: '([unclosed', replacement: 'x' });
    fixture.detectChanges(); // arm the debounce, do not settle
    // Feedback is immediate: the broken pattern flags right away…
    expect(dialog['patternError']()).toBe('Invalid regular expression');
    // …while the scan still shows the settled query's preview.
    expect(dialog['rows']()).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    expect(dialog['patternError']()).toBe('Invalid regular expression');
    expect(dialog['rows']()).toEqual([]);
  });

  it('flushes a pending query on apply so a fast type→Replace never uses stale rows', async () => {
    const dialog = await createDialog();
    dialog['model'].set({ query: 'saber', replacement: 'artoria pendragon' });
    fixture.detectChanges(); // typed, NOT settled: the preview still lags
    expect(dialog['rows']()).toEqual([]);

    await dialog['apply']();

    const updated = workspace.entries().find((e) => e.id === 0);
    assert(updated);
    // Byte-identical to what the settled preview (and the sibling test
    // above) produced: same rows, same rewrites.
    expect(updated.keys).toEqual(['artoria pendragon']);
    expect(updated.secondary_keys).toEqual(['artoria', 'artoria pendragon']);
    expect(updated.content).toBe('artoria pendragon is silent about the Grail.');
  });

  it('flushes a pending replacement on apply too', async () => {
    const dialog = await createDialog();
    await typeIn(dialog, 'saber', 'old-value'); // the query is settled
    dialog['model'].set({ query: 'saber', replacement: 'new-value' }); // only the replacement changed
    fixture.detectChanges(); // arm, do not settle
    const staleRow = dialog['rows']()[0];
    assert(staleRow);
    // The preview still previews the OLD replacement…
    expect(staleRow.nextContent).toBe('old-value is silent about the Grail.');

    await dialog['apply']();

    const updated = workspace.entries().find((e) => e.id === 0);
    assert(updated);
    // …but Replace applies the one actually in the input.
    expect(updated.content).toBe('new-value is silent about the Grail.');
  });

  it('labels the per-row include checkbox for assistive technology', async () => {
    const fixture = await createDialogDom();
    await typeIn(fixture.componentInstance, 'saber', 'artoria');
    fixture.detectChanges();

    const input = (fixture.nativeElement as HTMLElement).querySelector(
      '.result-row mat-checkbox input',
    );
    assert(input);
    // Material nulls [attr.aria-label] on the host: only the component
    // input reaches the native input element.
    expect(input.getAttribute('aria-label')).toBe('Include entry Saber');
  });

  it('narrows the preview through the scope chips', async () => {
    const fixture = await createDialogDom();
    const dialog = fixture.componentInstance;
    await typeIn(dialog, 'a', 'e'); // matches both entries
    fixture.detectChanges();
    expect(dialog['rows']().map((row) => row.entryId)).toEqual([0, 1]);

    const chips = fixture.debugElement.queryAll(
      By.css('mat-chip-listbox[aria-label="Search scope"] mat-chip-option'),
    );
    expect(chips).toHaveLength(2);
    chips[1]?.componentInstance.selectViaInteraction();
    fixture.detectChanges();

    expect(dialog['rows']().map((row) => row.entryId)).toEqual([1]);
  });

  it('renders preview rows, badges, key chips and live apply-button state', async () => {
    const fixture = await createDialogDom();
    const dialog = fixture.componentInstance;
    await typeIn(dialog, 'saber', 'artoria');
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('.result-row')).toHaveLength(1);
    expect(el.querySelector('.result-title')?.textContent?.trim()).toBe('Saber');
    expect([...el.querySelectorAll('.hit-badges .badge')].map((b) => b.textContent?.trim())).toEqual(
      ['content ×1', 'keys ×2'],
    );

    // Key preview: the old title on the left, one chip per rewritten key.
    const keyPreview = el.querySelector('.key-preview');
    expect(keyPreview?.querySelector('.old')?.textContent?.trim()).toBe('Saber');
    expect([...el.querySelectorAll('.key-chip')].map((c) => c.textContent?.trim())).toEqual([
      'artoria',
      'artoria',
      'artoria',
    ]);

    const applyButton = el.querySelector<HTMLButtonElement>(
      'mat-dialog-actions button:last-child',
    );
    assert(applyButton);
    expect(applyButton.textContent).toContain('Replace in 1 entry');
    expect(applyButton.disabled).toBe(false);

    // Unchecking the row's inclusion drains the button to zero and disables
    // it. The row header doubles as the checkbox label, so a click on it
    // toggles the native input.
    const rowLabel = el.querySelector<HTMLElement>('.result-row label');
    assert(rowLabel);
    rowLabel.click();
    fixture.detectChanges();

    expect(applyButton.textContent).toContain('Replace in 0 entries');
    expect(applyButton.disabled).toBe(true);
  });

  it('guides the user through the empty, no-match and broken-pattern states', async () => {
    const fixture = await createDialogDom();
    const el = fixture.nativeElement as HTMLElement;
    const dialog = fixture.componentInstance;

    // No query yet: the result block renders but stays silent.
    expect(el.querySelector('.no-results')?.textContent?.trim()).toBe('');
    expect(el.querySelector('.preview-header')?.textContent).toContain(
      'Type a query to preview matches',
    );

    // A well-formed query without matches.
    await typeIn(dialog, 'shirou', 'x');
    fixture.detectChanges();
    expect(el.querySelector('.no-results')?.textContent).toContain(
      'No matches found for the current scope.',
    );

    // A broken regex: the hint names the problem and the empty state defers to it.
    dialog['regexMode'].set(true);
    await typeIn(dialog, '([unclosed', 'x');
    fixture.detectChanges();
    expect(el.querySelector('.pattern-error')?.textContent).toContain(
      'Invalid regular expression',
    );
    expect(el.querySelector('.no-results')?.textContent).toContain(
      'Fix the pattern to see matches.',
    );
  });

  it('highlights preview changes and cycles hunks with the navigator', async () => {
    workspace.activeProject.set(
      projectOf([
        entry(1, {
          comment: 'Rin',
          // A context line between the two changes yields two diff hunks.
          content: 'Rin studies magecraft.\nA middle context line.\nRin is busy.',
        }),
      ]),
    );
    const fixture = await createDialogDom();
    const dialog = fixture.componentInstance;
    await typeIn(dialog, 'Rin', 'Luvia');
    fixture.detectChanges();
    await fixture.whenStable();

    const el = fixture.nativeElement as HTMLElement;
    const diff = el.querySelector('app-diff-viewer');
    assert(diff);
    expect(el.querySelectorAll('.diff-line.added')).toHaveLength(2);
    expect(el.querySelectorAll('.diff-line.removed')).toHaveLength(2);

    const counter = diff.querySelector('.hunk-counter');
    assert(counter);
    expect(counter.textContent?.trim()).toBe('1 / 2');
    expect(diff.querySelector('.hunk-current')?.getAttribute('data-hunk')).toBe('0');

    // Next parks the highlight on the second change hunk.
    diff.querySelector<HTMLButtonElement>('[aria-label="Next change"]')?.click();
    fixture.detectChanges();
    expect(counter.textContent?.trim()).toBe('2 / 2');
    expect(diff.querySelector('.hunk-current')?.getAttribute('data-hunk')).toBe('1');

    // Previous steps back to the first.
    diff.querySelector<HTMLButtonElement>('[aria-label="Previous change"]')?.click();
    fixture.detectChanges();
    expect(counter.textContent?.trim()).toBe('1 / 2');
    expect(diff.querySelector('.hunk-current')?.getAttribute('data-hunk')).toBe('0');
  });
});
