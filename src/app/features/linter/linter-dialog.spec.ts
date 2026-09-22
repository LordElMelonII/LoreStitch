import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { MatChipOption } from '@angular/material/chips';
import { MatTooltip } from '@angular/material/tooltip';
import { MatDialogRef } from '@angular/material/dialog';
import { CharacterBookEntry } from '../../core/models/lorebook.model';
import { LintPrefs } from '../../core/models/project.model';
import { WorkspaceService } from '../../core/services/workspace.service';
import { LinterDialog } from './linter-dialog';
import { entryWith as entry, projectOf, severityFixture } from '../../../testing/project-fixtures';

describe('LinterDialog', () => {
  let workspace: WorkspaceService;
  let closeSpy: ReturnType<typeof vi.fn>;
  let dismissSpy: ReturnType<typeof vi.fn>;
  let fixture: ComponentFixture<LinterDialog>;

  /**
   * Seeds the workspace, then mounts the pane against it, optionally with
   * exactly the host container refs a production open would provide. The
   * overrides land before any `TestBed.inject` — injecting instantiates the
   * test module, and providers cannot be overridden after that (the About
   * spec's documented ordering).
   */
  async function createDialog(
    entries: CharacterBookEntry[],
    options: { prefs?: LintPrefs; dialog?: boolean; sheet?: boolean } = {},
  ): Promise<LinterDialog> {
    TestBed.overrideProvider(MatDialogRef, {
      useValue: options.dialog ? { close: closeSpy } : null,
    });
    TestBed.overrideProvider(MatBottomSheetRef, {
      useValue: options.sheet ? { dismiss: dismissSpy } : null,
    });
    workspace = TestBed.inject(WorkspaceService);
    // Allow the workspace's async init() to settle before seeding.
    await new Promise((resolve) => setTimeout(resolve, 0));
    workspace.activeProject.set(
      projectOf(entries, {
        id: 'linter-dialog-project',
        title: 'Linter',
        ...(options.prefs ? { lintPrefs: options.prefs } : {}),
      }),
    );
    fixture = TestBed.createComponent(LinterDialog);
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  /**
   * The mute row's chip options (the entry editor spec's pattern): component
   * instances for state reads/`toggleSelected`, native elements for DOM
   * assertions, addressed by label text.
   */
  function muteChips(): { chip: MatChipOption; native: HTMLElement }[] {
    return fixture.debugElement
      .queryAll(By.css('.mute-row mat-chip-option'))
      .map((option) => ({
        chip: option.componentInstance as MatChipOption,
        native: option.nativeElement as HTMLElement,
      }));
  }

  beforeEach(async () => {
    closeSpy = vi.fn();
    dismissSpy = vi.fn();
    TestBed.configureTestingModule({ imports: [LinterDialog] });
    // `workspace` is injected inside createDialog — after the provider
    // overrides, since injecting instantiates the test module.
  });

  it('renders the header with the pluralized all-three summary and close button', async () => {
    await createDialog(severityFixture());

    expect(el().querySelector('.pane-title')?.textContent).toBe('Health check');
    expect(el().querySelector('.summary')?.textContent?.trim()).toBe(
      '1 error · 1 warning · 1 note',
    );
    expect(el().querySelector('[aria-label="Close health check"]')).toBeTruthy();
  });

  it('groups sections Errors → Warnings → Notes and omits empty ones', async () => {
    await createDialog(severityFixture());
    expect(
      [...el().querySelectorAll('.section-heading')].map((h) => h.textContent?.trim()),
    ).toEqual(['Errors (1)', 'Warnings (1)', 'Notes (1)']);
  });

  it('renders an info-only book as just the Notes section', async () => {
    await createDialog([
      entry(0, { comment: 'Selective', keys: ['paris'], selective: true, secondary_keys: [] }),
    ]);
    expect(el().querySelectorAll('.severity-section')).toHaveLength(1);
    expect(el().querySelector('.section-heading')?.textContent?.trim()).toBe('Notes (1)');
  });

  it('renders the core message verbatim with details, chip, and Go-to action', async () => {
    await createDialog([entry(0, { comment: 'Broken regex', keys: ['/servant(/'] })]);

    expect(el().querySelector('.message')?.textContent?.trim()).toBe(
      'Entry "Broken regex" has a regex-shaped key that is not a valid regex — SillyTavern will not treat it as a regex.',
    );
    expect(el().querySelector('.details')?.textContent?.trim()).toBe('/servant(/');
    // Single-entry rows: decorative chip + trailing jump with the entry name.
    expect(el().querySelector('.entry-chip')?.textContent?.trim()).toBe('Broken regex');
    // One-line ellipsis polish: the chip carries the full title for hover,
    // and the DOM text stays the accessible name (CSS truncation only).
    expect(el().querySelector('.entry-chip')?.getAttribute('title')).toBe('Broken regex');
    const goto = el().querySelector('.goto-button');
    expect(goto?.textContent?.trim()).toBe('Go to entry');
    expect(goto?.getAttribute('aria-label')).toBe('Go to entry: Broken regex');
  });

  it('jumps to the entry and closes through the live dialog ref', async () => {
    await createDialog([entry(0, { comment: 'Broken regex', keys: ['/servant(/'] })], {
      dialog: true,
    });

    el().querySelector('.goto-button')?.dispatchEvent(new Event('click'));

    expect(workspace.activeTabId()).toBe(0);
    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(dismissSpy).not.toHaveBeenCalled();
  });

  it('renders multi-entry jumps as named stroked buttons instead of one trailing action', async () => {
    await createDialog(
      [
        entry(0, { comment: 'Saber', keys: ['Excalibur'] }),
        entry(1, { comment: 'Rider', keys: ['Excalibur'] }),
      ],
      { dialog: true },
    );

    const row = el().querySelector('.diagnostic-row');
    const jumps = [...(row?.querySelectorAll('.jump-button') ?? [])];
    expect(jumps).toHaveLength(2);
    // Real Material stroked buttons (the user-endorsed "two buttons" fix),
    // titled per entry with the trailing jump glyph.
    expect(jumps.every((jump) => jump.classList.contains('mat-mdc-outlined-button'))).toBe(true);
    expect(jumps[0]?.textContent).toContain('Saber');
    expect(jumps[1]?.textContent).toContain('Rider');
    expect(
      jumps.every((jump) => jump.querySelector('mat-icon')?.textContent === 'north_east'),
    ).toBe(true);
    expect(jumps.map((jump) => jump.getAttribute('aria-label'))).toEqual([
      'Go to entry Saber',
      'Go to entry Rider',
    ]);
    // The decorative metadata chips stay out of multi-entry rows, and no
    // single trailing Go-to: the named buttons carry the jumps.
    expect(row?.querySelector('.entry-chip')).toBeNull();
    expect(el().querySelector('.goto-button')).toBeNull();

    jumps[1]?.dispatchEvent(new Event('click'));
    expect(workspace.activeTabId()).toBe(1);
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it('renders the book-level perf note as icon and message only — but still ignorable', async () => {
    // 1501 entries: one above LARGE_BOOK_THRESHOLD, so the graph rules emit
    // the single skip note (entryIds []). Constant entries keep the fixture
    // quiet — no per-entry diagnostics — and keep the pass fast.
    const big = Array.from({ length: 1501 }, (_, id) => entry(id, { constant: true }));
    await createDialog(big);

    expect(el().querySelectorAll('.diagnostic-row')).toHaveLength(1);
    expect(el().querySelector('.section-heading')?.textContent).toContain('Notes');
    const row = el().querySelector('.diagnostic-row');
    expect(row?.querySelector('.message')?.textContent).toContain(
      'the recursion cycle and self-trigger checks are skipped',
    );
    // Zero-entry rows offer nothing to jump into — but per §3.6.5.3 every row
    // keeps the not-an-issue affordance.
    expect(row?.querySelector('.jump-button')).toBeNull();
    expect(row?.querySelector('.entry-chip')).toBeNull();
    expect(row?.querySelector('.goto-button')).toBeNull();
    expect(row?.querySelector('.not-an-issue-button')).toBeTruthy();
  });

  it('shows the empty state for a clean book, with zero counts in the summary', async () => {
    await createDialog([entry(0, { comment: 'Clean', keys: ['paris'], content: 'Plain prose.' })]);

    const empty = el().querySelector('.empty-state');
    expect(empty).toBeTruthy();
    expect(empty?.querySelector('mat-icon')?.textContent).toContain('verified');
    expect(empty?.textContent).toContain('No issues found — lorebook looks healthy.');
    expect(el().querySelector('.summary')?.textContent?.trim()).toBe(
      '0 errors · 0 warnings · 0 notes',
    );
    expect(el().querySelector('.mute-row')).toBeNull();
    expect(el().querySelector('.severity-section')).toBeNull();
    expect(el().querySelector('.ignored-footer')).toBeNull();
  });

  it('offers a mute chip per rule in the unfiltered pass and toggles them', async () => {
    await createDialog(severityFixture());

    const labels = () => muteChips().map((entry) => entry.native.textContent?.trim());
    expect(labels()).toEqual(['Invalid regex', 'Never activatable', 'Selective without secondary']);
    // The entry editor's chip semantics: selected (filled + check) = on.
    expect(muteChips().map((entry) => entry.chip.selected)).toEqual([true, true, true]);

    // Deselect the keyless check: its rows vanish, its whole (empty) section
    // stops rendering, and the chip stays visible deselected (muted).
    const keyless = muteChips().find((entry) => entry.native.textContent?.includes('Never activatable'));
    assert(keyless);
    keyless.chip.toggleSelected(true);
    fixture.detectChanges();

    expect(
      [...el().querySelectorAll('.section-heading')].map((h) => h.textContent?.trim()),
    ).toEqual(['Errors (1)', 'Notes (1)']);
    // setRuleMuted's prefs write is pinned in linter-state.spec; the dialog
    // test pins the affordance behavior around it.
    const muted = muteChips().find((entry) => entry.native.textContent?.includes('Never activatable'));
    assert(muted);
    // Muted = NOT selected — the editor chip's outlined/deselected state.
    // (aria-selected lives on the chip's inner action button, role="option".)
    expect(muted.chip.selected).toBe(false);
    expect(muted.native.querySelector('button[role="option"]')?.getAttribute('aria-selected')).toBe(
      'false',
    );

    // Select again: the rule re-enables and its section returns.
    muted.chip.toggleSelected(true);
    fixture.detectChanges();
    expect(
      [...el().querySelectorAll('.section-heading')].map((h) => h.textContent?.trim()),
    ).toEqual(['Errors (1)', 'Warnings (1)', 'Notes (1)']);
  });

  it('keeps the mute row when every rule is muted and the filtered pass is empty', async () => {
    await createDialog(severityFixture());

    // Mute every rule the unfiltered pass offers.
    for (const entry of muteChips()) {
      entry.chip.toggleSelected(true);
    }
    fixture.detectChanges();

    // The filtered diagnostics are gone…
    expect(el().querySelectorAll('.diagnostic-row')).toHaveLength(0);
    expect(el().querySelector('.empty-state')).toBeTruthy();
    expect(el().querySelector('.severity-section')).toBeNull();
    // …but the chip row stays above it: the all-muted state keeps its
    // recovery path (issue-2 regression, 2026-09-19).
    const allMuted = muteChips();
    expect(allMuted).toHaveLength(3);
    expect(allMuted.every((entry) => !entry.chip.selected)).toBe(true);

    // And a chip is still selectable: unmuting one brings its rows back.
    const first = allMuted[0];
    assert(first);
    first.chip.toggleSelected(true);
    fixture.detectChanges();
    expect(el().querySelectorAll('.diagnostic-row')).toHaveLength(1);
    expect(el().querySelector('.empty-state')).toBeNull();
  });

  it('ignores a row through the not-an-issue affordance and offers Undo all', async () => {
    await createDialog(severityFixture());

    const notAnIssue = el().querySelector('.not-an-issue-button');
    assert(notAnIssue);
    expect(notAnIssue.getAttribute('aria-label')).toBe('Not an issue');
    notAnIssue.dispatchEvent(new Event('click'));
    fixture.detectChanges();

    expect(el().querySelectorAll('.diagnostic-row')).toHaveLength(2);
    // ignoreDiagnostic's signature write is pinned in linter-state.spec; this
    // test pins the footer affordance around it.
    const footer = el().querySelector('.ignored-footer');
    expect(footer?.textContent).toContain('1 issue marked not-an-issue');
    expect(footer?.textContent).toContain('Undo all');

    el().querySelector('.ignored-footer button')?.dispatchEvent(new Event('click'));
    fixture.detectChanges();

    expect(el().querySelector('.ignored-footer')).toBeNull();
    expect(el().querySelectorAll('.diagnostic-row')).toHaveLength(3);
  });

  it('shows the footer for prefs ignored before the pane opened', async () => {
    await createDialog(severityFixture(), {
      prefs: { ignoredSignatures: ['invalid-regex|0|/servant(/'], mutedRules: [] },
    });

    expect(el().querySelectorAll('.diagnostic-row')).toHaveLength(2);
    expect(el().querySelector('.ignored-footer')?.textContent).toContain(
      '1 issue marked not-an-issue',
    );
  });

  it('carries the pinned tooltips on the not-an-issue and mute-chip controls', async () => {
    await createDialog(severityFixture());

    const row = fixture.debugElement.query(By.css('.not-an-issue-button'));
    assert(row);
    expect(row.injector.get(MatTooltip).message).toBe('Not an issue');

    const chip = fixture.debugElement.query(By.css('.mute-row mat-chip-option'));
    assert(chip);
    expect(chip.injector.get(MatTooltip).message).toBe('Mute this check');
  });

  it('closes through the dialog ref when hosted in a MatDialog', async () => {
    const dialog = await createDialog(
      [entry(0, { comment: 'Broken regex', keys: ['/servant(/'] })],
      {
        dialog: true,
      },
    );
    dialog['close']();

    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(dismissSpy).not.toHaveBeenCalled();
  });

  it('dismisses through the bottom-sheet ref when hosted in a MatBottomSheet', async () => {
    const dialog = await createDialog(
      [entry(0, { comment: 'Broken regex', keys: ['/servant(/'] })],
      {
        sheet: true,
      },
    );
    dialog['close']();

    expect(dismissSpy).toHaveBeenCalledTimes(1);
    expect(closeSpy).not.toHaveBeenCalled();
  });

  it('tolerates close with neither container ref present', async () => {
    const dialog = await createDialog([
      entry(0, { comment: 'Broken regex', keys: ['/servant(/'] }),
    ]);
    expect(() => dialog['close']()).not.toThrow();
    expect(closeSpy).not.toHaveBeenCalled();
    expect(dismissSpy).not.toHaveBeenCalled();
  });
});
