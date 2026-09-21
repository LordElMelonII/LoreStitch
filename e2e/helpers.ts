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
 * Creates a project through the welcome screen so the studio shell appears.
 * The title labels the project only; every spec starts from the same empty book.
 */
export async function createProject(page: Page, title: string): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel('Project title').fill(title);
  await page.getByRole('button', { name: 'Create Project' }).click();
  await expect(page.locator('[aria-label="More actions menu"]')).toBeVisible();
  await expect(page.locator('.entries-sidenav')).toBeAttached();
}

/**
 * Opens the first visible entry (its tab becomes the active editor pane).
 *
 * Viewport-aware: below the shell's 768px breakpoint the entries sidenav is
 * an off-canvas `over` drawer, so it is toggled open before the click and
 * released again afterwards (the editor renders behind it).
 */
export async function openFirstEntry(page: Page): Promise<void> {
  const viewport = page.viewportSize();
  const mobile = viewport !== null && viewport.width < 768;
  const drawerToggle = page.locator('[aria-label="Toggle entries panel"]');
  if (mobile) {
    await drawerToggle.click();
    await expect(page.getByRole('heading', { name: 'Entries' })).toBeVisible();
  }
  await page.locator('.entry-item').first().click();
  await expect(page.locator('app-entry-editor .entry-tabs')).toBeVisible();
  if (mobile) {
    // Release the drawer so the editor pane behind it is interactable, and
    // re-zero the workspace in case the drawer-close focus restore panned it
    // sideways (see delimiters' phone choreography for the same settle).
    await drawerToggle.click();
    await expect(page.locator('.entries-sidenav')).not.toBeInViewport();
    await page.evaluate(() => {
      const workspace = document.querySelector('.workspace') as HTMLElement | null;
      if (workspace) {
        workspace.scrollLeft = 0;
      }
    });
  }
}

/**
 * Checks the selection checkboxes of the first two visible entry rows.
 *
 * Viewport-aware: below the shell's 768px breakpoint the entries sidenav is
 * an off-canvas `over` drawer, so the rows (and their checkboxes) are not
 * visible until the drawer is toggled open. The `Batch actions` toolbar that
 * appears with the selection keeps one DOM contract everywhere — role,
 * aria-label, the `N selected` count — but its location is
 * breakpoint-dependent by design (Task 06 §3.2): the inline header toolbar
 * inside the drawer on tablet/desktop, the docked bottom bar's transplanted
 * toolbar on phones. The single `getByRole` assertion below therefore
 * resolves to the bar's strip on phones and to the drawer's header on wider
 * viewports — callers need no viewport branch.
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
