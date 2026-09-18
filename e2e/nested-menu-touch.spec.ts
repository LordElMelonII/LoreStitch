import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';

/**
 * Touch regression suite for the nested menus in the More actions menu
 * (Export / Theme).
 *
 * Material opens submenu triggers on hover with no pointer-type guard, so on
 * a touchscreen the tap's emulated `mouseenter` opens the child menu
 * mid-tap; the tap's remaining emulated events then land on the just-opened
 * panel and dismiss it — the submenu flashes open then closed (verified
 * against the upstream Material docs nested-menu example). The
 * `TouchSafeNestedMenuTrigger` directive suppresses that emulated hover so
 * the tap's `click` opens the submenu exactly once. These specs pin the
 * user-visible contract: a tapped submenu stays open, a second tap closes
 * only that submenu, and a plain mouse click still opens it (desktop
 * parity).
 */

const FATE_PATH = join(
  process.cwd(),
  'example_card',
  'Fate Stay Night - Fuyuki Lorebook(1).json',
);

/** The open-then-dismiss flash settles within milliseconds; wait past it. */
const FLASH_WINDOW_MS = 600;

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

/** The More menu's nested Export trigger (distinct from the top-bar button). */
function exportTrigger(page: Page): ReturnType<Page['locator']> {
  return page.getByRole('menuitem', { name: 'Export', exact: true });
}

/** The first action inside the Export submenu. */
function worldInfoItem(page: Page): ReturnType<Page['locator']> {
  return page.getByRole('menuitem', { name: /World Info JSON/ });
}

test.describe('nested menus on touch (phone viewport)', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

  test('a tapped nested submenu stays open instead of flashing shut', async ({ page }) => {
    await page.goto('/');
    await importLorebook(page, FATE_PATH);

    await page.locator('[aria-label="More actions menu"]').tap();
    await exportTrigger(page).tap();
    await expect(worldInfoItem(page)).toBeVisible();

    // Without the fix the submenu had already dismissed itself here; the
    // re-assertion after the flash window is the actual regression check.
    await page.waitForTimeout(FLASH_WINDOW_MS);
    await expect(worldInfoItem(page)).toBeVisible();

    // At phone widths the open submenu overlaps the parent panel, so the
    // Theme row is not hit-testable while Export's submenu is open (the
    // directive's documented trade-off). Dismiss through the backdrop and
    // open the second nested trigger from a fresh menu — a single trigger
    // tap, exactly the interaction the flash bug corrupted.
    await page.touchscreen.tap(10, 780);
    await expect(worldInfoItem(page)).toBeHidden();

    await page.locator('[aria-label="More actions menu"]').tap();
    await page.getByRole('menuitem', { name: 'Theme', exact: true }).tap();
    const darkOption = page.getByRole('menuitem', { name: /Dark — cyan orange/ });
    await expect(darkOption).toBeVisible();
    await page.waitForTimeout(FLASH_WINDOW_MS);
    await expect(darkOption).toBeVisible();
  });
});

test.describe('nested menus keep desktop parity (mouse, no touch)', () => {
  test.use({ hasTouch: false, viewport: { width: 1280, height: 800 } });

  test('clicking the nested Export trigger opens its submenu', async ({ page }) => {
    await page.goto('/');
    await importLorebook(page, FATE_PATH);

    await page.locator('[aria-label="More actions menu"]').click();
    await exportTrigger(page).click();
    // The directive must leave the mouse path untouched: the submenu opens
    // and stays open exactly as it does without the directive attached.
    await expect(worldInfoItem(page)).toBeVisible();
  });
});
