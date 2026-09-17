import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';

/**
 * Acceptance suite for the ROADMAP's high-priority batch/token/split
 * features: the top-bar always-active token meter + inspector, the sidebar
 * batch selection bar with bulk operations, and the "export selected entries
 * as lorebook" split dialog.
 */

const FATE_PATH = join(
  process.cwd(),
  'example_card',
  'Fate Stay Night - Fuyuki Lorebook(1).json',
);

/** Imports a lorebook file through the welcome screen. */
async function importLorebook(page: Page, path: string): Promise<void> {
  const importChooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import .json / .stproj' }).click();
  await (await importChooser).setFiles(path);
  // Assert the project-open top bar, not merely an attached sidenav: a
  // silently failed import would otherwise slip through here.
  await expect(page.locator('[aria-label="More actions menu"]')).toBeVisible();
  await expect(page.locator('.entries-sidenav')).toBeAttached();
}

/** Checks the selection checkboxes of the first two visible entry rows. */
async function selectFirstTwoRows(page: Page): Promise<void> {
  const rows = page.locator('.entry-item');
  await rows.first().locator('.row-select').click();
  await rows.nth(1).locator('.row-select').click();
  await expect(page.getByRole('toolbar', { name: 'Batch actions' })).toContainText(
    '2 selected',
  );
}

test.describe('batch operations, token meter & split export', () => {
  test('shows the always-active token meter and opens the inspector', async ({ page }) => {
    await page.goto('/');
    await importLorebook(page, FATE_PATH);

    const meter = page.locator('[aria-label*="Always active token footprint"]');
    await expect(meter).toBeVisible();
    // The Fate lorebook carries four enabled constant entries, so the meter
    // shows a non-zero estimate.
    await expect(meter).toContainText('~');

    await meter.click();
    const inspector = page.getByRole('heading', { name: 'Always Active Token Footprint' });
    await expect(inspector).toBeVisible();
    await expect(page.getByRole('listitem').first()).toBeVisible();
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(inspector).toBeHidden();
  });

  test('batch-disables selected entries through the batch dialog', async ({ page }) => {
    await page.goto('/');
    await importLorebook(page, FATE_PATH);
    await selectFirstTwoRows(page);

    await page.locator('[aria-label="Batch edit selection"]').click();
    await expect(page.getByRole('heading', { name: 'Batch Edit 2 Entries' })).toBeVisible();

    await page.getByRole('radio', { name: 'Disable' }).click();
    await page.getByRole('button', { name: 'Apply to 2 entries' }).click();

    // The dialog applies and the selection bar clears; the snackbar confirms
    // the bulk write and the first row flips to its disabled state.
    await expect(page.getByRole('toolbar', { name: 'Batch actions' })).toBeHidden();
    await expect(page.locator('.entry-item').first()).toHaveClass(/disabled-entry/);
  });

  test('batch tagging feeds the sidebar tag filter', async ({ page }) => {
    await page.goto('/');
    await importLorebook(page, FATE_PATH);
    await selectFirstTwoRows(page);

    await page.locator('[aria-label="Batch edit selection"]').click();
    await expect(page.getByRole('heading', { name: 'Batch Edit 2 Entries' })).toBeVisible();
    await page.getByLabel('Tags to add to the selected entries').fill('e2e-tag');
    await page.getByRole('button', { name: 'Apply to 2 entries' }).click();

    // The tag becomes a filter chip; activating it isolates the group and
    // clearing it restores the full list.
    const tagChip = page.locator('.list-header .tag-chip', { hasText: 'e2e-tag' });
    await expect(tagChip).toBeVisible();
    await tagChip.click();
    await expect(page.locator('.list-header .count')).toHaveText('2');
    await tagChip.click();
    await expect(page.locator('.list-header .count')).toHaveText('70');
  });

  test('the token meter flags when constant entries exceed the budget', async ({ page }) => {
    await page.goto('/');
    await importLorebook(page, FATE_PATH);

    const meter = page.locator('[aria-label*="Always active token footprint"]');
    await expect(meter).toBeVisible();
    await meter.click();
    const inspector = page.getByRole('heading', { name: 'Always Active Token Footprint' });
    await expect(inspector).toBeVisible();

    // A tiny budget pushes the constant footprint over the limit: the bar
    // turns red and the caption reports the overshoot.
    await page.getByLabel('Token budget').fill('10');
    await expect(page.locator('.budget-bar')).toHaveClass(/over-budget/);
    await expect(page.locator('.budget-caption')).toContainText('Over budget');
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(inspector).toBeHidden();
  });

  test('exports the selection as a standalone world-info file', async ({ page }) => {
    await page.goto('/');
    await importLorebook(page, FATE_PATH);
    await selectFirstTwoRows(page);

    await page.locator('[aria-label="Export selection as lorebook"]').click();
    await expect(
      page.getByRole('heading', { name: 'Export Selected Entries as Lorebook' }),
    ).toBeVisible();

    // Verify format dropdown includes clarifying descriptions
    const formatSelect = page.locator('.format-field mat-select');
    await expect(formatSelect).toBeVisible();
    await formatSelect.click();
    const listbox = page.getByRole('listbox', { name: 'Export file format' });
    await expect(listbox.getByText('Direct import into SillyTavern’s World Info panel')).toBeVisible();
    await expect(listbox.getByText('Spec format for character cards & third-party tools')).toBeVisible();
    await page.getByRole('option', { name: /SillyTavern World Info/ }).click();

    await expect(page.getByRole('button', { name: 'Export 2 entries' })).toBeEnabled();

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export 2 entries' }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/-world-info\.json$/);
    const exported = JSON.parse(readFileSync(await download.path(), 'utf8')) as {
      entries: Record<string, unknown>;
    };
    // Exactly the two selected entries, as a valid native world-info file.
    expect(Object.keys(exported.entries)).toHaveLength(2);
  });
});
