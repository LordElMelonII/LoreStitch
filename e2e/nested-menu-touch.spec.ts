import { expect, type Page, test } from '@playwright/test';
import { FATE_PATH, importLorebook } from './helpers';

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

/** The open-then-dismiss flash settles within milliseconds; wait past it. */
const FLASH_WINDOW_MS = 600;

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
  // Cold WebKit boot + import + the two flash windows exceed the default 30s
  // budget when the whole suite runs at once (observed as the Import button
  // never settling under worker load) — same allowance as the other mobile
  // suites (delimiters 75s, round-trip 90s).
  test.describe.configure({ timeout: 75_000 });
  // Project gate (plan §3.5.5): a phone + touch leg by design — mobile-chrome
  // and mobile-safari cover both engines with real device descriptors, so a
  // desktop-project run would only duplicate mobile-chrome.
  test.skip(
    () => test.info().project.name === 'desktop-chrome',
    'touch flash regression runs on the mobile projects only',
  );

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
  // Project gate (plan §3.5.5): pins a mouse-driven desktop viewport, so the
  // mobile projects would only replay the desktop interaction under a phone
  // UA; desktop-chrome already covers it.
  test.skip(
    () => test.info().project.name.startsWith('mobile-'),
    'desktop parity leg runs on the desktop project only',
  );

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
