import { expect, type Locator, type Page, test } from '@playwright/test';
import {
  EXAMPLE_TEST_LOREBOOK_PATH,
  activeEditorPane,
  expectSnackbar,
  importLorebook,
  openEntryRow,
  setEntryContent,
} from './helpers';

/**
 * Two-tab session lock (task 11 §3.6): at most one tab edits a project; a
 * second tab gets the takeover prompt, the losing tab degrades to read-only
 * (topbar pill + editor veil + gated-write snackbar), and nothing typed is
 * ever discarded — the takeover flushes the losing tab's pending save before
 * the lock changes hands (the non-destructive pin).
 *
 * Every test runs BOTH pages inside ONE BrowserContext (`context.newPage()`):
 * one Web Locks space and one IndexedDB — the production two-tab condition.
 * Pages sync on UI states (prompt visibility, editor content, pill/veil
 * presence), never on sleeps; the one sanctioned pause is the
 * EDIT_COMMIT_FLUSH window below (round-trip.spec precedent) because no DOM
 * fact discriminates a pending text-slice draft from a committed one.
 *
 * The flows are viewport-agnostic and declared for the full matrix — no
 * project skips here. The "New entry" trigger branches on the shell's 768px
 * breakpoint exactly the component reads: the topbar button above it (two
 * "New entry" controls share that accessible name, so the click is scoped to
 * the application toolbar), the mobile bottom bar's item below it — both
 * route to the same gated write.
 */

/** The form mirror's idle commit: 300ms debounce + margin (round-trip.spec). */
const EDIT_COMMIT_FLUSH_MS = 400;

const A_EDIT = 'Typed by page A before page B took the lock over.';
const B_EDIT = 'Typed by page B while it holds the lock.';
const STALE_EDIT = 'Typed by page A, whose tab then closed without any handshake.';
const PAGEHIDE_EDIT =
  'Typed by page A, whose tab closed inside the save debounce window.';

/** The takeover prompt (ConfirmDialog over the shell, every breakpoint). */
function takeoverPrompt(page: Page): Locator {
  return page.getByRole('dialog', { name: 'Project open in another tab' });
}

/** The topbar read-only pill (universal breakpoint, task 11 §3.3). */
function readOnlyPill(page: Page): Locator {
  return page.getByRole('button', {
    name: 'Read-only — held by another tab. Select to try taking over.',
  });
}

/** The veil over the whole editor pane while this tab may not edit. */
function editorVeil(page: Page): Locator {
  return page.locator('.session-veil');
}

/**
 * Clicks the "New entry" control this viewport actually renders: the topbar
 * button above the shell's 768px breakpoint, the mobile bottom bar's item
 * below it (the `openExportMenu` helper's branch, same boundary).
 */
async function clickNewEntry(page: Page): Promise<void> {
  const viewport = page.viewportSize();
  if (viewport !== null && viewport.width < 768) {
    await page
      .locator('app-mobile-bottom-bar nav .bar-item')
      .filter({ hasText: 'New entry' })
      .click();
  } else {
    await page.getByLabel('Application toolbar').getByLabel('New entry').click();
  }
}

/**
 * Waits the import-success snackbar out — visible first, then detached (the
 * capture.mjs precedent: a hidden-only wait can win the race before it
 * mounts). On phones the bar spans the bottom edge and would cover the next
 * click target.
 */
async function settleImportSnackbar(page: Page): Promise<void> {
  const bar = page.locator('.mat-mdc-snack-bar-container');
  await bar.waitFor({ state: 'visible', timeout: 15_000 });
  await bar.waitFor({ state: 'detached', timeout: 9_000 });
}

/**
 * Page A's boot: import the two-entry fixture through the welcome screen so
 * the project exists to fight over. A ends up holding its lock.
 */
async function importAsHolder(page: Page): Promise<void> {
  await page.goto('/');
  await importLorebook(page, EXAMPLE_TEST_LOREBOOK_PATH);
  await settleImportSnackbar(page);
}

test.describe('two-tab session lock', () => {
  // Two page boots, a takeover handshake, a snackbar auto-dismiss window and
  // a pagehide flush per test — the default 30s budget expires mid-flow.
  test.describe.configure({ timeout: 90_000 });

  test('takeover is non-destructive: B sees A’s typed edit, A degrades to read-only', async ({
    context,
  }) => {
    const a = await context.newPage();
    await importAsHolder(a);
    await openEntryRow(a, 0);
    await setEntryContent(a, A_EDIT);
    // The text-slice edit commits to the workspace on idle. When the 400ms
    // save debounce has not fired yet, the takeover's flush-before-release
    // (unit-pinned order) is what carries the edit to storage.
    await a.waitForTimeout(EDIT_COMMIT_FLUSH_MS);

    // Page B boots into the same context: auto-opens the same project, hits
    // the held lock, and gets the takeover prompt over the real data.
    const b = await context.newPage();
    await b.goto('/');
    const prompt = takeoverPrompt(b);
    await expect(prompt).toBeVisible();
    await expect(prompt.getByText('No edits are lost either way.')).toBeVisible();

    await prompt.getByRole('button', { name: 'Take over' }).click();
    await expect(prompt).toBeHidden();

    // The losing tab: read-only pill + veil, editor content inert.
    await expect(readOnlyPill(a)).toBeVisible();
    await expect(editorVeil(a)).toContainText(
      'Editing paused — this project is open in another tab.',
    );
    await expect(a.locator('app-entry-editor .entry-tabs')).toHaveAttribute('inert', '');

    // The winner: no pill, no veil, and the reload-on-acquire re-derived the
    // flushed storage state — A's typed edit is in the entry (the
    // non-destructive pin). B then edits on its own lock.
    await expect(readOnlyPill(b)).toHaveCount(0);
    await expect(editorVeil(b)).toHaveCount(0);
    await openEntryRow(b, 0);
    const bContent = activeEditorPane(b).getByLabel('Entry content', { exact: true });
    await expect(bContent).toHaveValue(A_EDIT);
    await setEntryContent(b, B_EDIT);
    await expect(bContent).toHaveValue(B_EDIT);
  });

  test('two tabs on two different projects both edit; a new project never prompts', async ({
    context,
  }) => {
    const a = await context.newPage();
    await importAsHolder(a); // project 1: two entries

    // B boots into project 1 (A holds it) — the designed blocked-boot prompt;
    // dismissed here, the pass below is about the NEW project colliding never.
    const b = await context.newPage();
    await b.goto('/');
    const prompt = takeoverPrompt(b);
    await expect(prompt).toBeVisible();
    await prompt.getByRole('button', { name: 'Stay read-only' }).click();
    await expect(readOnlyPill(b)).toBeVisible();
    await expect(editorVeil(b)).toBeVisible();

    // B creates a NEW project: a fresh id attaches a free lock (the gated
    // write surface never covers create), so no prompt and no read-only UI.
    await b.locator('[aria-label="Projects menu"]').click();
    await b.getByRole('menuitem', { name: 'New project…' }).click();
    const newDialog = b.getByRole('dialog', { name: 'New Project' });
    await expect(newDialog).toBeVisible();
    await newDialog.getByLabel('Project title').fill('Second project');
    await newDialog.getByRole('button', { name: 'Create Project' }).click();
    await expect(newDialog).toBeHidden();
    await expect(takeoverPrompt(b)).toHaveCount(0);

    // B edits project 2 freely: no pill, no veil, the empty editor takes an
    // entry (a gated write would snack and no-op instead).
    await expect(readOnlyPill(b)).toHaveCount(0);
    await expect(editorVeil(b)).toHaveCount(0);
    await expect(b.locator('app-entry-editor .empty-editor')).toBeVisible();
    await clickNewEntry(b);
    await expect(b.locator('app-entry-editor .entry-tabs')).toBeVisible();

    // A never left project 1 and still edits it — both tabs live at once.
    await expect(readOnlyPill(a)).toHaveCount(0);
    await expect(editorVeil(a)).toHaveCount(0);
    await clickNewEntry(a);
    await expect(a.locator('app-entry-editor .entry-tab-label')).toHaveCount(3);
  });

  test('stale holder: A closes without the handshake; B re-probes, resumes, sees the saved edit', async ({
    context,
  }) => {
    const a = await context.newPage();
    await importAsHolder(a);
    await openEntryRow(a, 0);
    await setEntryContent(a, STALE_EDIT);
    await a.waitForTimeout(EDIT_COMMIT_FLUSH_MS);

    const b = await context.newPage();
    await b.goto('/');
    const prompt = takeoverPrompt(b);
    await expect(prompt).toBeVisible();
    await prompt.getByRole('button', { name: 'Stay read-only' }).click();

    // Blocked tab: pill + veil up; a gated write snacks the read-only copy.
    await expect(readOnlyPill(b)).toBeVisible();
    await expect(editorVeil(b)).toBeVisible();
    await clickNewEntry(b);
    await expectSnackbar(b, 'Read-only — this project is held by another tab');

    // A dies WITHOUT the handshake. A plain close is the real "tab
    // destroyed" semantics: the headless shell releases the lock
    // immediately (probed). The plan's runBeforeUnload flavor was probed
    // leaving a ZOMBIE lock holder for seconds — that models a hung tab
    // (plan §7.2), not a dead one, and made the recovery racy.
    await a.close();
    // Headless never delivers focus/visibilitychange (every page reports
    // visibilityState 'visible' + hasFocus() true at all times, so
    // bringToFront cannot produce the transition the plan assumed —
    // probed): fire the app's real window-focus listener, whose handler
    // runs the stale-holder re-probe (plan §3.4) against the freed lock.
    await b.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(readOnlyPill(b)).toHaveCount(0);
    await expect(editorVeil(b)).toHaveCount(0);

    // The reload-on-acquire re-derived storage: A's saved edit is in the
    // entry B opens.
    await openEntryRow(b, 0);
    const bContent = activeEditorPane(b).getByLabel('Entry content', { exact: true });
    await expect(bContent).toHaveValue(STALE_EDIT);

    // Editing resumed: the add lands (tab count grows) and a fresh edit
    // sticks in the new entry the add opened.
    await clickNewEntry(b);
    await expect(b.locator('app-entry-editor .entry-tab-label')).toHaveCount(3);
    await setEntryContent(b, B_EDIT);
    await expect(bContent).toHaveValue(B_EDIT);
  });

  test('pagehide flush: closing inside the save debounce still lands the edit', async ({
    context,
  }) => {
    const a = await context.newPage();
    await importAsHolder(a);
    await openEntryRow(a, 0);
    await setEntryContent(a, PAGEHIDE_EDIT);
    // Only the slice commit is awaited: the 400ms storage debounce is still
    // pending at close — the pagehide flush is what carries the edit.
    await a.waitForTimeout(EDIT_COMMIT_FLUSH_MS);
    // The pagehide flush (plan §3.5) runs through the app's REAL registered
    // window listener. The headless shell never delivers pagehide on a hard
    // close, and its runBeforeUnload simulation leaves a zombie lock holder
    // (probed — it also made this case flaky), so the event is fired
    // explicitly and the environment is destroyed with a plain close, which
    // releases the lock immediately like a real tab close does.
    await a.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await a.close();

    // A fresh tab boots into the freed project: auto-open takes the lock
    // outright — no prompt, no pill, no veil.
    const b = await context.newPage();
    await b.goto('/');
    await expect(b.locator('app-entry-editor .entry-tabs')).toBeVisible();
    await expect(takeoverPrompt(b)).toHaveCount(0);
    await expect(readOnlyPill(b)).toHaveCount(0);

    // Re-open the project through the Projects menu: a fresh storage read
    // once the close-time flush has fully settled (the boot's own read can
    // race the last IndexedDB transaction of the dying tab).
    await b.locator('[aria-label="Projects menu"]').click();
    await b.getByRole('menuitem').first().click();
    await openEntryRow(b, 0);
    await expect(activeEditorPane(b).getByLabel('Entry content', { exact: true })).toHaveValue(
      PAGEHIDE_EDIT,
    );
  });
});
