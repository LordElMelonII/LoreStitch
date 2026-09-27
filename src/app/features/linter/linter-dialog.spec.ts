import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { MatChipOption } from '@angular/material/chips';
import { MatTooltip } from '@angular/material/tooltip';
import { MatDialogRef } from '@angular/material/dialog';
import { CharacterBookEntry } from '../../core/models/lorebook.model';
import { LintPrefs } from '../../core/models/project.model';
import { WorkspaceService } from '../../core/services/workspace.service';
import { HEALTH_RUN_YIELD, LinterState } from './linter-state';
import { LinterDialog } from './linter-dialog';
import { entryWith as entry, projectOf, severityFixture } from '../../../testing/project-fixtures';

describe('LinterDialog', () => {
  let workspace: WorkspaceService;
  let linterState: LinterState;
  let closeSpy: ReturnType<typeof vi.fn>;
  let dismissSpy: ReturnType<typeof vi.fn>;
  let fixture: ComponentFixture<LinterDialog>;

  // --- Health-run scheduler seam (plan 19 D4) --------------------------------

  /**
   * The default spec scheduler: immediate. A run completes within one
   * macrotask flush, so the result-view tests below only need `settleRun`
   * after any prefs mutation (the pane's restart effect restarts the run).
   */
  const immediateYield = async (): Promise<void> => undefined;
  let activeYield: () => Promise<void> = immediateYield;
  const tunableYield = (): Promise<void> => activeYield();

  /** Chunk gates of the gated scheduler, one per awaited chunk boundary. */
  let gates: (() => void)[] = [];

  /** Real-timer flush: drains the run's scheduler chain deterministically. */
  async function flushRun(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  /** Lets a just-started/restarted run land (immediate scheduler) and re-render. */
  async function settleRun(): Promise<void> {
    await flushRun();
    fixture.detectChanges();
  }

  /** Advances a gated run by exactly one chunk boundary. */
  async function pumpChunk(): Promise<void> {
    gates.splice(0).forEach((release) => release());
    await flushRun();
  }

  /** Pumps a gated run chunk by chunk until it delivers (bounded). */
  async function pumpToDone(maxChunks = 100): Promise<void> {
    for (let i = 0; i < maxChunks && linterState.healthRun().kind !== 'done'; i += 1) {
      await pumpChunk();
    }
  }

  /**
   * Seeds the workspace, then mounts the pane against it, optionally with
   * exactly the host container refs a production open would provide. The
   * overrides land before any `TestBed.inject` — injecting instantiates the
   * test module, and providers cannot be overridden after that (the About
   * spec's documented ordering). Unless `scheduler: 'gated'` holds the run at
   * its chunk boundaries, the health run is flushed to its delivered results
   * before the component is returned.
   */
  async function createDialog(
    entries: CharacterBookEntry[],
    options: {
      prefs?: LintPrefs;
      dialog?: boolean;
      sheet?: boolean;
      scheduler?: 'immediate' | 'gated';
    } = {},
  ): Promise<LinterDialog> {
    if (options.scheduler === 'gated') {
      gates = [];
      activeYield = () => new Promise<void>((resolve) => gates.push(resolve));
    }
    TestBed.overrideProvider(MatDialogRef, {
      useValue: options.dialog ? { close: closeSpy } : null,
    });
    TestBed.overrideProvider(MatBottomSheetRef, {
      useValue: options.sheet ? { dismiss: dismissSpy } : null,
    });
    workspace = TestBed.inject(WorkspaceService);
    linterState = TestBed.inject(LinterState);
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
    if (options.scheduler !== 'gated') {
      await settleRun();
    }
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
    return fixture.debugElement.queryAll(By.css('.mute-row mat-chip-option')).map((option) => ({
      chip: option.componentInstance as MatChipOption,
      native: option.nativeElement as HTMLElement,
    }));
  }

  beforeEach(async () => {
    closeSpy = vi.fn();
    dismissSpy = vi.fn();
    activeYield = immediateYield;
    gates = [];
    TestBed.configureTestingModule({ imports: [LinterDialog] });
    // The run scheduler seam — overridden before any inject instantiates
    // the module, exactly like the container-ref overrides in createDialog.
    TestBed.overrideProvider(HEALTH_RUN_YIELD, { useValue: tunableYield });
    // `workspace` is injected inside createDialog — after the provider
    // overrides, since injecting instantiates the test module.
  });

  // --- Health run (plan 19 D4) ------------------------------------------------

  it('renders the loading state before results — bar and checking copy, no results content', async () => {
    await createDialog(severityFixture(), { scheduler: 'gated' });

    // Loading: the determinate bar at its starting value and the copy in the
    // header's status line — while none of the results view exists yet.
    expect(el().querySelector('.summary')?.textContent?.trim()).toBe('Checking lorebook health…');
    const bar = el().querySelector('mat-progress-bar');
    expect(bar).toBeTruthy();
    expect(bar?.getAttribute('aria-valuenow')).toBe('0');
    expect(el().querySelector('.mute-row')).toBeNull();
    expect(el().querySelector('.severity-section')).toBeNull();
    expect(el().querySelector('.empty-state')).toBeNull();
    expect(el().querySelector('.ignored-footer')).toBeNull();

    // Delivering replaces the loading state with the unchanged results view.
    await pumpToDone();
    fixture.detectChanges();
    expect(el().querySelector('mat-progress-bar')).toBeNull();
    expect(el().querySelector('.summary')?.textContent?.trim()).toBe(
      '1 error · 1 warning · 1 note',
    );
    expect(el().querySelectorAll('.severity-section')).toHaveLength(3);
  });

  it('advances the bar monotonically into the graph-dominated range, then delivers', async () => {
    await createDialog(severityFixture(), { scheduler: 'gated' });

    // One value per pumped chunk, from the bar's own aria-valuenow.
    const values: number[] = [0];
    for (let i = 0; i < 10 && linterState.healthRun().kind !== 'done'; i += 1) {
      await pumpChunk();
      fixture.detectChanges();
      const now = el().querySelector('mat-progress-bar')?.getAttribute('aria-valuenow');
      if (now !== null && now !== undefined) {
        values.push(Number(now));
      }
    }
    // Monotonic and honest: the bar walks into the graph phase's 10–100%
    // interval (the recursion graph dominates wall time on large books) —
    // for this fixture the sources chunk reports 10 + (3/4)·90 ≈ 78.
    let previous = 0;
    const ascending = values.every((value) => {
      const ok = value >= previous;
      previous = value;
      return ok;
    });
    expect(ascending).toBe(true);
    expect(values.at(-1)).toBeGreaterThan(50);

    // Done: results replace the bar (no 100% frame to sit on — the pane is
    // the results view the moment the pass completes).
    await pumpToDone();
    fixture.detectChanges();
    expect(el().querySelector('mat-progress-bar')).toBeNull();
    expect(el().querySelectorAll('.diagnostic-row')).toHaveLength(3);
  });

  it('restarts the run on a mute-chip mutation and stale runs never overwrite newer results', async () => {
    await createDialog(severityFixture(), { scheduler: 'gated' });
    await pumpToDone();
    fixture.detectChanges(); // run A delivered — the chips exist only here
    expect(el().querySelectorAll('.diagnostic-row')).toHaveLength(3);

    // Muting through the real chip click: prefs write → project mutation →
    // the pane's restart effect starts run B (the approved loading cadence).
    const keyless = muteChips().find((chip) =>
      chip.native.textContent?.includes('Never activatable'),
    );
    assert(keyless);
    keyless.chip.toggleSelected(true);
    await settleRun();
    expect(el().querySelector('.summary')?.textContent?.trim()).toBe('Checking lorebook health…');
    expect(el().querySelector('mat-progress-bar')).toBeTruthy();

    await pumpToDone();
    fixture.detectChanges();
    // B's delivered results: the muted warning's section is gone.
    expect(
      [...el().querySelectorAll('.section-heading')].map((h) => h.textContent?.trim()),
    ).toEqual(['Errors (1)', 'Notes (1)']);
    expect(el().querySelector('.summary')?.textContent?.trim()).toBe(
      '1 error · 0 warnings · 1 note',
    );

    // Start run C with a second real chip click, hold it mid-flight, then
    // mutate again — the newer run (D) must supersede C between steps.
    const regex = muteChips().find((chip) => chip.native.textContent?.includes('Invalid regex'));
    assert(regex);
    regex.chip.toggleSelected(true);
    await settleRun(); // C starts
    await pumpChunk(); // C mid-flight, suspended at a chunk gate
    linterState.unmuteAll(); // a newer mutation — D supersedes C
    await settleRun();
    expect(el().querySelector('.summary')?.textContent?.trim()).toBe('Checking lorebook health…');

    await pumpToDone();
    fixture.detectChanges();
    // D's delivered results: everything unmuted, all three sections back.
    // C's late (still-muted) steps never surfaced — they would have rendered
    // ['Warnings (1)', 'Notes (1)'].
    expect(
      [...el().querySelectorAll('.section-heading')].map((h) => h.textContent?.trim()),
    ).toEqual(['Errors (1)', 'Warnings (1)', 'Notes (1)']);
    expect(el().querySelector('.summary')?.textContent?.trim()).toBe(
      '1 error · 1 warning · 1 note',
    );
    expect(muteChips().every((chip) => chip.chip.selected)).toBe(true);
  });

  it('stops driving the run when the pane closes', async () => {
    await createDialog(severityFixture(), { scheduler: 'gated' });
    await pumpChunk(); // mid-run, suspended at a chunk gate
    expect(linterState.healthRun().kind).toBe('running');

    fixture.destroy(); // the DestroyRef hook stops the pane's run session

    expect(linterState.healthRun().kind).toBe('idle');

    // Whatever gate the suspended driver held resolves now — the driver must
    // exit without stepping or awaiting again: no results, no new gates.
    await pumpChunk();
    expect(linterState.healthRun().kind).toBe('idle');
    expect(gates).toHaveLength(0);
  });

  // --- Results view (unchanged contract; setup waits for the run) -------------

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

  it('still lists recursion-graph findings the topbar badge no longer counts (plan 18 D4)', async () => {
    // The badge reads the graph-free entryDiagnostics pass, so a live
    // recursion cycle no longer lights it (linter-state.spec pins that);
    // this pane's delivered run keeps listing it.
    await createDialog([
      entry(0, { comment: 'Alpha', keys: ['alpha'], content: 'the beta rises' }),
      entry(1, { comment: 'Beta', keys: ['beta'], content: 'the alpha falls' }),
    ]);

    expect(el().querySelector('.summary')?.textContent?.trim()).toBe(
      '0 errors · 1 warning · 0 notes',
    );
    const warnings = [...el().querySelectorAll('.severity-section')].find(
      (section) => section.getAttribute('data-severity') === 'warning',
    );
    assert(warnings);
    expect(warnings.querySelector('.section-heading')?.textContent?.trim()).toBe('Warnings (1)');
    expect(warnings.querySelector('.message')?.textContent).toContain(
      'may activate during recursion',
    );
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

  // --- Mute / ignore flows off the delivered results --------------------------

  it('offers a mute chip per rule in the unfiltered pass and toggles them', async () => {
    await createDialog(severityFixture());

    const labels = () => muteChips().map((entry) => entry.native.textContent?.trim());
    expect(labels()).toEqual(['Invalid regex', 'Never activatable', 'Selective without secondary']);
    // The entry editor's chip semantics: selected (filled + check) = on.
    expect(muteChips().map((entry) => entry.chip.selected)).toEqual([true, true, true]);

    // Deselect the keyless check: its rows vanish, its whole (empty) section
    // stops rendering, and the chip stays visible deselected (muted). The
    // prefs write restarts the run — settle it, then read the fresh results.
    const keyless = muteChips().find((entry) =>
      entry.native.textContent?.includes('Never activatable'),
    );
    assert(keyless);
    keyless.chip.toggleSelected(true);
    await settleRun();

    expect(
      [...el().querySelectorAll('.section-heading')].map((h) => h.textContent?.trim()),
    ).toEqual(['Errors (1)', 'Notes (1)']);
    // setRuleMuted's prefs write is pinned in linter-state.spec; the dialog
    // test pins the affordance behavior around it.
    const muted = muteChips().find((entry) =>
      entry.native.textContent?.includes('Never activatable'),
    );
    assert(muted);
    // Muted = NOT selected — the editor chip's outlined/deselected state.
    // (aria-selected lives on the chip's inner action button, role="option".)
    expect(muted.chip.selected).toBe(false);
    expect(muted.native.querySelector('button[role="option"]')?.getAttribute('aria-selected')).toBe(
      'false',
    );

    // Select again: the rule re-enables and its section returns.
    muted.chip.toggleSelected(true);
    await settleRun();
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
    await settleRun();

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
    await settleRun();
    expect(el().querySelectorAll('.diagnostic-row')).toHaveLength(1);
    expect(el().querySelector('.empty-state')).toBeNull();
  });

  it('ignores a row through the not-an-issue affordance and offers Undo all', async () => {
    await createDialog(severityFixture());

    const notAnIssue = el().querySelector('.not-an-issue-button');
    assert(notAnIssue);
    expect(notAnIssue.getAttribute('aria-label')).toBe('Not an issue');
    notAnIssue.dispatchEvent(new Event('click'));
    await settleRun();

    expect(el().querySelectorAll('.diagnostic-row')).toHaveLength(2);
    // ignoreDiagnostic's signature write is pinned in linter-state.spec; this
    // test pins the footer affordance around it.
    const footer = el().querySelector('.ignored-footer');
    expect(footer?.textContent).toContain('1 issue marked not-an-issue');
    expect(footer?.textContent).toContain('Undo all');

    el().querySelector('.ignored-footer button')?.dispatchEvent(new Event('click'));
    await settleRun();

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

  // --- Container refs (the dual-container contract) ---------------------------

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
