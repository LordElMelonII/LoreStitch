import { expect, type Page, test } from '@playwright/test';

/**
 * About pane suite: version/build metadata, the changelog viewer and the
 * open-source credits.
 *
 * The same About component adapts to the viewport (topbar.openAbout):
 * - >= 768px opens a centered MatDialog (pane class `app-about-dialog`).
 * - < 768px opens a MatBottomSheet (pane class `app-about-sheet`).
 * Each describe targets one container and skips the mirrored breakpoint, so
 * the config's three projects cover both containers with fast, focused runs.
 */

/** Dev/test builds ship "1.0.0"; release builds ship the real number — only the shape is contractual. */
const SEMVER = /\d+\.\d+\.\d+/;

/** The centered dialog variant's overlay pane. */
function aboutDialogPane(page: Page): ReturnType<Page['locator']> {
  return page.locator('.cdk-overlay-pane.app-about-dialog');
}

/** The bottom sheet variant's overlay pane. */
function aboutSheetPane(page: Page): ReturnType<Page['locator']> {
  return page.locator('.cdk-overlay-pane.app-about-sheet');
}

/** Opens the About pane from the always-visible top bar button. */
async function openAboutFromTopbar(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'About LoreStitch' }).click();
}

test.describe('about dialog (tablet/desktop)', () => {
  test.skip(
    ({ viewport }) => (viewport?.width ?? 0) < 768,
    'the centered dialog only opens at viewport widths >= 768px',
  );

  test('opens from the top bar on the welcome screen with version and all tabs', async ({
    page,
  }) => {
    await openAboutFromTopbar(page);
    const pane = aboutDialogPane(page);
    await expect(pane).toBeVisible();

    await expect(pane.getByRole('heading', { name: 'LoreStitch' })).toBeVisible();
    // The version row must carry a semver; the dev-server build additionally
    // shows a "development build" chip next to it.
    await expect(pane.locator('.meta-row', { hasText: 'Version' })).toContainText(SEMVER);
    for (const tab of ['About', 'Changelog', 'Open Source']) {
      await expect(pane.getByRole('tab', { name: tab })).toBeVisible();
    }
  });

  test('changelog tab renders the release history with its Highlights sections', async ({
    page,
  }) => {
    await openAboutFromTopbar(page);
    const pane = aboutDialogPane(page);
    await expect(pane).toBeVisible();

    await pane.getByRole('tab', { name: 'Changelog' }).click();
    // The changelog is fetched from /CHANGELOG.md when the dialog opens;
    // toBeVisible waits out the loading spinner.
    //
    // The oldest release is a permanent part of the history; the newest one
    // moves with every release and is only pinned by its semver shape.
    await expect(pane.locator('.release-version', { hasText: '1.0.0' })).toBeVisible();
    await expect(pane.locator('.release-version').first()).toContainText(SEMVER);
    // Every release documents a "Highlights" section, so the title matches
    // several elements by design — take the newest (rendered first) rather
    // than handing strict mode a multiplicity it must reject.
    await expect(pane.locator('.section-title', { hasText: 'Highlights' }).first()).toBeVisible();
    await expect(pane.locator('.release-section').first()).toBeVisible();
  });

  test('open source tab credits Angular under the MIT license', async ({ page }) => {
    await openAboutFromTopbar(page);
    const pane = aboutDialogPane(page);
    await expect(pane).toBeVisible();

    await pane.getByRole('tab', { name: 'Open Source' }).click();
    await expect(pane.locator('.oss-name', { hasText: /^Angular$/ })).toBeVisible();
    // Several runtime entries share the MIT license; one rendered entry suffices.
    await expect(pane.locator('.oss-license', { hasText: 'MIT' }).first()).toBeVisible();
  });

  test('escape closes the dialog', async ({ page }) => {
    await openAboutFromTopbar(page);
    const pane = aboutDialogPane(page);
    await expect(pane).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(pane).toBeHidden();
  });

  test('opens from the More actions menu with a project and closes via its button', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'New project' }).first().click();
    await page.getByLabel('Project title').fill('E2E About');
    await page.getByRole('button', { name: 'Create Project' }).click();
    await expect(page.locator('[aria-label="More actions menu"]')).toBeVisible();

    await page.locator('[aria-label="More actions menu"]').click();
    // The trailing ellipsis distinguishes the menu entry from the identically
    // named top bar button, which is still present while a project is open.
    await page.getByRole('menuitem', { name: 'About LoreStitch…' }).click();
    const pane = aboutDialogPane(page);
    await expect(pane).toBeVisible();

    await pane.getByRole('button', { name: 'Close about' }).click();
    await expect(pane).toBeHidden();
  });
});

test.describe('about bottom sheet (mobile)', () => {
  test.skip(
    ({ viewport }) => (viewport?.width ?? 0) >= 768,
    'the bottom sheet only opens at viewport widths < 768px',
  );

  test('opens from the top bar as a sheet with the version info', async ({ page }) => {
    await openAboutFromTopbar(page);
    const pane = aboutSheetPane(page);
    await expect(pane).toBeVisible();
    await expect(pane.locator('.mat-bottom-sheet-container')).toBeVisible();

    await expect(pane.getByRole('heading', { name: 'LoreStitch' })).toBeVisible();
    await expect(pane.locator('.meta-row', { hasText: 'Version' })).toContainText(SEMVER);
  });

  test('close button dismisses the sheet', async ({ page }) => {
    await openAboutFromTopbar(page);
    const pane = aboutSheetPane(page);
    await expect(pane).toBeVisible();

    await pane.getByRole('button', { name: 'Close about' }).click();
    await expect(pane).toBeHidden();
  });
});
