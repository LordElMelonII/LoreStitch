import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { MatTooltip } from '@angular/material/tooltip';
import { MatDialogRef } from '@angular/material/dialog';
import {
  CharacterBookEntry,
  LintPrefs,
  ProjectWorkspace,
  createEmptyEntry,
} from '../../core/models/lorebook.model';
import { WorkspaceService } from '../../core/services/workspace.service';
import { LinterDialog } from './linter-dialog';

/** Builds an entry with sensible defaults for linter tests. */
function entry(id: number, overrides: Partial<CharacterBookEntry> = {}): CharacterBookEntry {
  return { ...createEmptyEntry(id), ...overrides };
}

function projectOf(entries: CharacterBookEntry[], lintPrefs?: LintPrefs): ProjectWorkspace {
  return {
    id: 'linter-dialog-project',
    title: 'Linter',
    createdAt: 1,
    updatedAt: 1,
    targetType: 'standalone_lorebook',
    activeBook: { name: 'Linter', extensions: {}, entries },
    headCommitId: null,
    commits: [],
    ...(lintPrefs ? { lintPrefs } : {}),
  };
}

/** One entry per severity: invalid regex (error), keyless (warning), selective but keyed (info). */
function severityFixture(): CharacterBookEntry[] {
  return [
    entry(0, { comment: 'Broken regex', keys: ['/servant(/'] }),
    entry(1, { comment: 'Keyless', keys: [] }),
    entry(2, { comment: 'Selective', keys: ['paris'], selective: true, secondary_keys: [] }),
  ];
}

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
  workspace.activeProject.set(projectOf(entries, options.prefs));
  fixture = TestBed.createComponent(LinterDialog);
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture.componentInstance;
}

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
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
    expect([...el().querySelectorAll('.section-heading')].map((h) => h.textContent?.trim())).toEqual([
      'Errors (1)',
      'Warnings (1)',
      'Notes (1)',
    ]);
  });

  it('renders an info-only book as just the Notes section', async () => {
    await createDialog([entry(0, { comment: 'Selective', keys: ['paris'], selective: true, secondary_keys: [] })]);
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

  it('makes the multi-entry chips the jump buttons instead of one trailing action', async () => {
    await createDialog(
      [
        entry(0, { comment: 'Saber', keys: ['Excalibur'] }),
        entry(1, { comment: 'Rider', keys: ['Excalibur'] }),
      ],
      { dialog: true },
    );

    const row = el().querySelector('.diagnostic-row');
    expect(row?.querySelectorAll('.jump-chip')).toHaveLength(2);
    const chips = [...el().querySelectorAll('.jump-chip')];
    expect(chips.map((chip) => chip.textContent?.trim())).toEqual(['Saber', 'Rider']);
    expect(chips.map((chip) => chip.getAttribute('aria-label'))).toEqual([
      'Go to entry Saber',
      'Go to entry Rider',
    ]);
    // No single trailing Go-to: the named chips carry the jumps.
    expect(el().querySelector('.goto-button')).toBeNull();

    chips[1]?.dispatchEvent(new Event('click'));
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
    expect(row?.querySelector('.jump-chip')).toBeNull();
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

    const chips = () => [...el().querySelectorAll('.mute-chip')];
    expect(chips().map((chip) => chip.textContent?.trim())).toEqual([
      'Invalid regex',
      'Never activatable',
      'Selective without secondary',
    ]);

    // Mute the keyless check: its rows vanish, its whole (empty) section
    // stops rendering, and the chip stays visible styled muted.
    const keylessChip = chips().find((chip) => chip.textContent?.includes('Never activatable'));
    assert(keylessChip);
    keylessChip.dispatchEvent(new Event('click'));
    fixture.detectChanges();

    expect([...el().querySelectorAll('.section-heading')].map((h) => h.textContent?.trim())).toEqual([
      'Errors (1)',
      'Notes (1)',
    ]);
    expect(workspace.activeProject()?.lintPrefs?.mutedRules).toEqual(['never-activatable']);
    const mutedChip = chips().find((chip) => chip.textContent?.includes('Never activatable'));
    assert(mutedChip);
    expect(mutedChip.classList.contains('muted')).toBe(true);
    expect(mutedChip.getAttribute('aria-pressed')).toBe('true');

    // Click again: the rule re-enables and its section returns.
    mutedChip.dispatchEvent(new Event('click'));
    fixture.detectChanges();
    expect(workspace.activeProject()?.lintPrefs?.mutedRules).toEqual([]);
    expect([...el().querySelectorAll('.section-heading')].map((h) => h.textContent?.trim())).toEqual([
      'Errors (1)',
      'Warnings (1)',
      'Notes (1)',
    ]);
  });

  it('ignores a row through the not-an-issue affordance and offers Undo all', async () => {
    await createDialog(severityFixture());

    const notAnIssue = el().querySelector('.not-an-issue-button');
    assert(notAnIssue);
    expect(notAnIssue.getAttribute('aria-label')).toBe('Not an issue');
    notAnIssue.dispatchEvent(new Event('click'));
    fixture.detectChanges();

    expect(el().querySelectorAll('.diagnostic-row')).toHaveLength(2);
    expect(workspace.activeProject()?.lintPrefs?.ignoredSignatures).toEqual([
      'invalid-regex|0|/servant(/',
    ]);
    const footer = el().querySelector('.ignored-footer');
    expect(footer?.textContent).toContain('1 issue marked not-an-issue');
    expect(footer?.textContent).toContain('Undo all');

    el().querySelector('.ignored-footer button')?.dispatchEvent(new Event('click'));
    fixture.detectChanges();

    expect(workspace.activeProject()?.lintPrefs?.ignoredSignatures).toEqual([]);
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

    const chip = fixture.debugElement.query(By.css('.mute-chip'));
    assert(chip);
    expect(chip.injector.get(MatTooltip).message).toBe('Mute this check');
  });

  it('closes through the dialog ref when hosted in a MatDialog', async () => {
    const dialog = await createDialog([entry(0, { comment: 'Broken regex', keys: ['/servant(/'] })], {
      dialog: true,
    });
    dialog['close']();

    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(dismissSpy).not.toHaveBeenCalled();
  });

  it('dismisses through the bottom-sheet ref when hosted in a MatBottomSheet', async () => {
    const dialog = await createDialog([entry(0, { comment: 'Broken regex', keys: ['/servant(/'] })], {
      sheet: true,
    });
    dialog['close']();

    expect(dismissSpy).toHaveBeenCalledTimes(1);
    expect(closeSpy).not.toHaveBeenCalled();
  });

  it('tolerates close with neither container ref present', async () => {
    const dialog = await createDialog([entry(0, { comment: 'Broken regex', keys: ['/servant(/'] })]);
    expect(() => dialog['close']()).not.toThrow();
    expect(closeSpy).not.toHaveBeenCalled();
    expect(dismissSpy).not.toHaveBeenCalled();
  });
});
