import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import {
  DEFECTIVE_BOOK_PATH,
  EXAMPLE_TEST_LOREBOOK_PATH,
  exportWorldInfoOfferingRepair,
  exportWorldInfoViewportAware,
  expectProjectOpen,
  importLorebook,
  importLorebookOfferingRepair,
  openFirstEntry,
  setEntryContent,
} from './helpers';

/**
 * Book pre-flight validation & guided repair (plan 09 §3.6): a hand-crafted
 * third-party book carrying four fixable id/value defects (`e2e/fixtures/
 * defective-book.json` — duplicate id 2, string id "7", Infinity
 * insertion_order and priority) must be offered a repair at import, must
 * export with every entry intact once repaired (the anti-collapse pin: the
 * ST-native uid-keyed bag used to silently drop the later duplicate on
 * SillyTavern's parse), and a declined repair must block the export — while
 * a clean book never sees an offer in either direction.
 *
 * The approved dialog copy (checkpoint 09-1) is the locator vocabulary:
 * "Fix 4 issues before importing?/exporting?", "Fix 4 issues & import"/
 * "Import as-is", "Fix 4 issues & export"/"Cancel", kind labels
 * "Id corrected"/"Id renumbered"/"Insertion order set"/"Priority unset".
 */

interface ExportedEntry {
  uid: number;
  comment: string;
}

/**
 * The anti-collapse contract shared by the fix-at-import and fix-at-export
 * flows: the downloaded uid-keyed bag holds all five entries under unique
 * uids — "Gate house" keeps uid 2 (first occurrence), the renumbered
 * "River dock" ships as 4, the coerced "Tavern" as 7.
 */
function expectNoUidCollapse(json: Record<string, unknown>): void {
  const entries = json['entries'] as Record<string, ExportedEntry>;
  expect(Object.keys(entries), 'entries lost to a uid-key collapse').toHaveLength(5);
  const uids = Object.values(entries).map((entry) => entry.uid);
  expect(new Set(uids).size, 'uids must be unique across the exported bag').toBe(5);
  expect(entries['2']?.comment).toBe('Gate house');
  expect(entries['4']?.comment).toBe('River dock');
  expect(entries['7']?.comment).toBe('Tavern');
}

/**
 * Reads the entry-list rows with the drawer choreography phones need: below
 * the shell's 768px breakpoint the sidenav is an off-canvas `over` drawer, so
 * it is toggled open before the rows are read — and released again
 * afterwards, because an open drawer backdrops-blocks the next action target
 * (the openFirstEntry precedent). Asserts the RAW-import state on the way:
 * every entry of the defective fixture entered the workspace verbatim.
 */
async function readRawImportRows(page: Page): Promise<void> {
  const viewport = page.viewportSize();
  const mobile = viewport !== null && viewport.width < 768;
  const drawerToggle = page.locator('[aria-label="Toggle entries panel"]');
  if (mobile) {
    await drawerToggle.click();
    await expect(page.getByRole('heading', { name: 'Entries' })).toBeVisible();
  }
  await expect(page.locator('.entry-item')).toHaveCount(5);
  if (mobile) {
    await drawerToggle.click();
    await expect(page.locator('.entries-sidenav')).not.toBeInViewport();
  }
}

test.describe('book repair (pre-flight validation)', () => {
  // Import -> offer -> consent -> export -> download is a long interaction,
  // and the first test in the file also pays the dev server's cold compile
  // (the round-trip suite raises its budget for the same shape).
  test.describe.configure({ timeout: 90_000 });

  test('importing a defective book offers the repair with the planned changes listed', async ({
    page,
  }) => {
    await page.goto('/');
    const dialog = await importLorebookOfferingRepair(page, DEFECTIVE_BOOK_PATH);

    // Approved copy (checkpoint 09-1), pluralized over the four changes.
    await expect(dialog.locator('.title')).toContainText('Fix 4 issues before importing?');

    // The planner's verified output: Tavern "7"->7, River dock 2->4 plus
    // order ∞->100, Old forest priority ∞->unset.
    const changes = dialog.locator('.change');
    await expect(changes).toHaveCount(4);
    await expect(changes.filter({ hasText: 'Tavern' }).locator('.change-kind')).toHaveText(
      'Id corrected',
    );
    await expect(changes.filter({ hasText: 'River dock' })).toHaveCount(2);
    await expect(
      changes.filter({ hasText: 'River dock' }).filter({ hasText: 'Id renumbered' }),
    ).toHaveCount(1);
    await expect(
      changes.filter({ hasText: 'River dock' }).filter({ hasText: 'Insertion order set' }),
    ).toHaveCount(1);
    await expect(changes.filter({ hasText: 'Old forest' }).locator('.change-kind')).toHaveText(
      'Priority unset',
    );

    await expect(dialog.getByRole('button', { name: 'Fix 4 issues & import' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Import as-is' })).toBeVisible();
  });

  test('fix & import, then export: both duplicate-id entries ship with unique uids', async ({
    page,
  }) => {
    await page.goto('/');
    const dialog = await importLorebookOfferingRepair(page, DEFECTIVE_BOOK_PATH);
    await dialog.getByRole('button', { name: 'Fix 4 issues & import' }).click();
    await expectProjectOpen(page);

    // The repaired book validates clean: the ST-native download fires with no
    // further offer (a regression re-offering the dialog would time this out).
    const { json } = await exportWorldInfoViewportAware(page);

    // THE ANTI-COLLAPSE PIN: the uid-keyed bag carries both entries that used
    // to share id 2 — the silent collapse can never happen again.
    expectNoUidCollapse(json);
  });

  test('import as-is keeps the raw book; the export backstop re-offers and fix & export downloads the repair', async ({
    page,
  }) => {
    await page.goto('/');
    const importDialog = await importLorebookOfferingRepair(page, DEFECTIVE_BOOK_PATH);
    await importDialog.getByRole('button', { name: 'Import as-is' }).click();
    await expectProjectOpen(page);

    // The workspace holds the raw import: all five entries, defects included.
    await readRawImportRows(page);

    // The backstop at the door: the same offer in its export form, and no
    // download until it is answered.
    const exportDialog = await exportWorldInfoOfferingRepair(page);
    await expect(exportDialog.locator('.title')).toContainText('Fix 4 issues before exporting?');
    await expect(exportDialog.getByRole('button', { name: 'Fix 4 issues & export' })).toBeVisible();
    await expect(exportDialog.getByRole('button', { name: 'Cancel' })).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      exportDialog.getByRole('button', { name: 'Fix 4 issues & export' }).click(),
    ]);
    const json = JSON.parse(readFileSync(await download.path(), 'utf8')) as Record<
      string,
      unknown
    >;
    // The repair persisted through applyBookRepair: the re-export validated
    // clean and the same anti-collapse contract holds.
    expectNoUidCollapse(json);
  });

  test('declining the export repair downloads nothing', async ({ page }) => {
    await page.goto('/');
    const importDialog = await importLorebookOfferingRepair(page, DEFECTIVE_BOOK_PATH);
    await importDialog.getByRole('button', { name: 'Import as-is' }).click();
    await expectProjectOpen(page);

    const exportDialog = await exportWorldInfoOfferingRepair(page);
    // Arm the download watcher first: no byte may leave the app around the
    // Cancel. waitForEvent's timeout rejection maps to "no download fired".
    const downloadFired = page
      .waitForEvent('download', { timeout: 3_000 })
      .then(
        () => true,
        () => false,
      );
    await exportDialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(exportDialog).toBeHidden();
    expect(await downloadFired, 'a download fired after the repair was declined').toBe(false);
  });

  test('a clean book imports and edits with no repair offer in either direction', async ({
    page,
  }) => {
    await page.goto('/');
    // importLorebook waits for the workspace shell — an import-blocking offer
    // would time it out, and the pane count pin makes the absence explicit.
    await importLorebook(page, EXAMPLE_TEST_LOREBOOK_PATH);
    await expect(page.locator('app-book-repair-dialog')).toHaveCount(0);

    // The editor is fully usable on the imported clean book.
    await openFirstEntry(page);
    await setEntryContent(page, 'Edited without any repair offer.');
  });
});

test.describe('book repair phone form (bottom sheet)', () => {
  // Project gate (plan 09 §3.6): the dual-container phone form is the point —
  // mobile-chrome and mobile-safari cover both engines with real device
  // descriptors, so a desktop-project run would only replay the dialog form.
  test.skip(
    ({ viewport }) => (viewport?.width ?? 0) >= 768,
    'the bottom-sheet form runs on the mobile projects only',
  );
  test.describe.configure({ timeout: 90_000 });

  test('the import repair offer renders as a bottom sheet with stacked full-width actions', async ({
    page,
  }) => {
    await page.goto('/');
    const dialog = await importLorebookOfferingRepair(page, DEFECTIVE_BOOK_PATH);

    // The openResponsive phone form: the app-repair-sheet panel class on the
    // overlay pane, a Material sheet container carrying the pane.
    await expect(page.locator('.cdk-overlay-pane.app-repair-sheet')).toBeVisible();
    await expect(
      page.locator('mat-bottom-sheet-container[aria-label="Book repair"]'),
    ).toBeVisible();

    // The sheet anatomy per the approved mock (checkpoint 09-1): drag handle,
    // stacked actions (column-reverse over the secondary-first DOM order),
    // full-width buttons.
    await expect(dialog.locator('.drag-handle')).toBeVisible();
    const actions = dialog.locator('.actions');
    expect(await actions.evaluate((el) => getComputedStyle(el).flexDirection)).toBe(
      'column-reverse',
    );
    const primary = dialog.getByRole('button', { name: 'Fix 4 issues & import' });
    const widthRatio = await primary.evaluate((el) => {
      const pane = el.closest('.pane');
      return pane instanceof HTMLElement ? el.clientWidth / pane.clientWidth : 0;
    });
    expect(widthRatio, 'the sheet primary button spans the pane').toBeGreaterThan(0.9);

    // The same offer content as the dialog form, and the consent still works.
    await expect(dialog.locator('.title')).toContainText('Fix 4 issues before importing?');
    await primary.click();
    await expectProjectOpen(page);
  });
});
