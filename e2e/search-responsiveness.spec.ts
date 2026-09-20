import { expect, test, type Page } from '@playwright/test';
import { FATE_PATH, importLorebook } from './helpers';

/**
 * Task 07 (plan §3.6, e2e row): the debounced search surfaces, exercised as
 * a user sees them. The precise trailing-edge timing is pinned by the unit
 * suite (`debounced-signal.spec.ts`, fake timers); these specs pin the
 * user-visible contract: the sidebar count badge and the Search & Replace
 * preview settle to the filtered/scanned values after the debounce window,
 * the input itself never lags, and a full find → exclude → replace run
 * rewrites exactly the entries it previewed.
 *
 * Ground truth against the bundled Fate/Stay Night fixture (70 entries,
 * recomputed when the fixture changes — see the analyze script notes in the
 * task's phase report):
 * - "Excalibur" appears in 6 entries' sidebar haystacks;
 * - Search & Replace for "Excalibur" (defaults: literal, case-insensitive,
 *   content + keys) finds 9 occurrences across those same 6 entries (8 in
 *   contents, 1 as Saber's key), and the first preview row ("Power Scale -
 *   Parameter Ranks & Servants vs Magi") holds exactly 1 occurrence.
 */

/** `SEARCH_DEBOUNCE_MS` in src/app/shared/constants/search.ts. */
const DEBOUNCE_MS = 200;
/** Slack on the lower-bound pin below (clock rounding, CDP round trip). */
const DEBOUNCE_TOLERANCE_MS = 50;

const BOOK_ENTRIES = '70';
const QUERY = 'Excalibur';
const REPLACEMENT = 'HolyBladeMarker';
const FIRST_ROW_TITLE = 'Power Scale - Parameter Ranks & Servants vs Magi';

/** True below the shell's 768px breakpoint: off-canvas drawers + bottom bar. */
function isMobile(page: Page): boolean {
  const viewport = page.viewportSize();
  return viewport !== null && viewport.width < 768;
}

/** Reveals the entries drawer on phones (docked sidebar on tablet/desktop). */
async function revealSidebar(page: Page): Promise<void> {
  if (isMobile(page)) {
    await page.locator('[aria-label="Toggle entries panel"]').click();
    await expect(page.getByRole('heading', { name: 'Entries' })).toBeVisible();
  }
}

/**
 * Opens Search & Replace: the topbar's standalone button on tablet/desktop,
 * the mobile bottom bar's action on phones (both funnel into the same
 * `Topbar.openSearch` opener, so the pane and its config are identical).
 */
async function openSearchReplace(page: Page): Promise<void> {
  if (isMobile(page)) {
    await page.getByRole('button', { name: 'Search & replace' }).click();
  } else {
    await page.getByRole('button', { name: 'Search and replace' }).click();
  }
  await expect(page.getByRole('dialog')).toContainText('Search & Replace');
}

test.describe('debounced search surfaces', () => {
  test('sidebar filter settles after the debounce window and restores on clear', async ({
    page,
  }) => {
    await page.goto('/');
    await importLorebook(page, FATE_PATH);
    await revealSidebar(page);

    const badge = page.locator('.entries-sidenav .title-row .count');
    const filter = page.getByLabel('Filter entries', { exact: true });
    await expect(badge).toHaveText(BOOK_ENTRIES);

    const start = Date.now();
    await filter.fill(QUERY);
    // The input keeps its immediate form value — typing never lags behind
    // the scan; only the settled list lags.
    await expect(filter).toHaveValue(QUERY);
    // Settled filtered count: the auto-retrying assertion absorbs the
    // debounce window, so only the settled state is pinned — never a
    // mid-flicker intermediate.
    await expect(badge).toHaveText('6');
    // Directional debounce pin (a lower bound cannot false-fail): the scan
    // runs on the trailing timer, so the badge physically cannot settle
    // before the debounce window has elapsed since the keystroke. An
    // undebounced scan on this 70-entry book settles in tens of ms.
    expect(Date.now() - start).toBeGreaterThanOrEqual(DEBOUNCE_MS - DEBOUNCE_TOLERANCE_MS);

    // Clearing through the input's own clear button restores the full
    // count — again only after the window settles.
    await page.getByLabel('Clear filter', { exact: true }).click();
    await expect(filter).toHaveValue('');
    await expect(badge).toHaveText(BOOK_ENTRIES);
  });

  test('search & replace previews settle, honor row exclusion, and rewrite content', async ({
    page,
  }) => {
    await page.goto('/');
    await importLorebook(page, FATE_PATH);

    await openSearchReplace(page);

    const query = page.getByLabel('Search query', { exact: true });
    const header = page.locator('.preview-header');

    await query.fill(QUERY);
    // The preview settles after the debounce window (auto-retry absorbs
    // it): 9 occurrences of the query across 6 entries (8 in contents, 1
    // as a key).
    await expect(header).toContainText('9 matches in 6 entries');
    await expect(page.getByRole('button', { name: 'Replace in 6 entries' })).toBeEnabled();

    // Toggle the first row out of the run. Toggles are discrete taps — no
    // debounce — and the header keeps describing the whole book while the
    // action button describes the run: 6 preview rows stay, 5 replaceable.
    await page
      .getByRole('checkbox', { name: `Include entry ${FIRST_ROW_TITLE}`, exact: true })
      .uncheck();
    await expect(header).toContainText('9 matches in 6 entries');
    await expect(page.getByRole('button', { name: 'Replace in 5 entries' })).toBeEnabled();

    await page.getByLabel('Replacement text', { exact: true }).fill(REPLACEMENT);
    await page.getByRole('button', { name: 'Replace in 5 entries' }).click();

    // The run reports exactly what it wrote (the excluded entry's single
    // occurrence is not among it), then the pane closes. Snackbar selector
    // follows the delimiters suite's idiom (`.last()` — a predecessor bar
    // can still be mid-dismissal).
    const snackbar = page.locator('.mat-mdc-snack-bar-label').last();
    await expect(snackbar).toContainText('Replaced 8 occurrences across 5 entries');
    // Dismiss it: on phones the bar overlays the bottom bar whose Search
    // button the re-open below needs.
    await page.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(snackbar).toBeHidden();

    // Re-scan through the dialog itself: the original query now hits only
    // the excluded entry …
    await openSearchReplace(page);
    await query.fill(QUERY);
    await expect(header).toContainText('1 match in 1 entry');
    // … while the replacement text is present in the five rewritten ones.
    await query.fill(REPLACEMENT);
    await expect(header).toContainText('8 matches in 5 entries');
  });
});
