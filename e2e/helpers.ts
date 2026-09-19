import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Download, type Page } from '@playwright/test';

/** The bundled Fate/Stay Night fixture most suites import. */
export const FATE_PATH = join(
  process.cwd(),
  'example_card',
  'Fate Stay Night - Fuyuki Lorebook(1).json',
);

/**
 * Imports a lorebook file through the welcome screen, replacing the project.
 * The caller is responsible for navigating to `/` first.
 */
export async function importLorebook(page: Page, path: string): Promise<void> {
  const importChooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import .json / .stproj' }).click();
  await (await importChooser).setFiles(path);
  // Assert the project-open top bar, not merely an attached sidenav: the
  // welcome state also renders a sidenav, so a silently failed import would
  // otherwise slip through and every later editor interaction would time out.
  await expect(page.locator('[aria-label="More actions menu"]')).toBeVisible();
  await expect(page.locator('.entries-sidenav')).toBeAttached();
}

/** Exports via the top bar menu; resolves with the parsed JSON and its file. */
export async function exportWorldInfo(
  page: Page,
): Promise<{ json: Record<string, unknown>; download: Download }> {
  await page.locator('[aria-label="Export menu"]').click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByText('World Info JSON').first().click(),
  ]);
  const json = JSON.parse(readFileSync(await download.path(), 'utf8')) as Record<string, unknown>;
  return { json, download };
}

/**
 * Checks the selection checkboxes of the first two visible entry rows.
 *
 * Viewport-aware: below the shell's 768px breakpoint the entries sidenav is
 * an off-canvas `over` drawer, so the rows (and their checkboxes) are not
 * visible until the drawer is toggled open. The batch toolbar lives inside
 * the drawer too, so the whole selection flow stays within it.
 */
export async function selectFirstTwoRows(page: Page): Promise<void> {
  const viewport = page.viewportSize();
  if (viewport && viewport.width < 768) {
    await page.locator('[aria-label="Toggle entries panel"]').click();
    await expect(page.getByRole('heading', { name: 'Entries' })).toBeVisible();
  }
  const rows = page.locator('.entry-item');
  await rows.first().locator('.row-select').click();
  await rows.nth(1).locator('.row-select').click();
  await expect(page.getByRole('toolbar', { name: 'Batch actions' })).toContainText(
    '2 selected',
  );
}
