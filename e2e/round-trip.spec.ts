import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { devices, expect, type Download, type Page, test } from '@playwright/test';

/**
 * Round-trip acceptance suite for native SillyTavern world-info files (the
 * ROADMAP's high-priority verification): import the bundled Fate/Stay Night
 * lorebook, edit an entry through the studio UI, export it back as World Info
 * JSON, and compare the download against the original — `stlo` book metadata,
 * every entry attribute, and the made modifications must all survive.
 * Also covers the two high-priority bug fixes: entry-list scrolling on touch
 * devices and the theme menu on the welcome screen.
 */

const FATE_PATH = join(process.cwd(), 'example_card', 'Fate Stay Night - Fuyuki Lorebook(1).json');

const original = JSON.parse(readFileSync(FATE_PATH, 'utf8')) as {
  stlo: Record<string, unknown>;
  entries: Record<string, Record<string, unknown>>;
};

/** The edits applied through the UI, mirrored by the export assertions. */
const EDIT = {
  group: 'test group',
  groupWeight: '77',
};

/** Imports a lorebook file through the welcome screen, replacing the project. */
async function importLorebook(page: Page, path: string): Promise<void> {
  const importChooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import .json / .stproj' }).click();
  await (await importChooser).setFiles(path);
  // Assert the project-open top bar, not merely an attached sidenav: the
  // welcome state also renders a sidenav, so a silently failed import would
  // otherwise slip through and every later editor interaction would time out.
  await expect(page.locator('[aria-label="More actions menu"]')).toBeVisible();
  await expect(page.locator('.entries-sidenav')).toBeAttached();
}

/** Opens the first visible entry and expands its options panel. */
async function openFirstEntryOptions(page: Page): Promise<void> {
  await page.locator('.entry-item').first().click();
  await expect(page.locator('app-entry-editor .entry-tabs')).toBeVisible();
  const panel = page.locator('[role="region"][aria-label*="Placement, activation"]').first();
  // The expanded state is shared studio-wide, so it may already be open.
  if ((await panel.getAttribute('inert')) !== null) {
    await page.locator('[aria-label="Toggle entry options"]').click();
  }
  await expect(panel).not.toHaveAttribute('inert');
}

/** Exports via the top bar menu; resolves with the parsed JSON and its file. */
async function exportWorldInfo(
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

test.describe('native lorebook round trip', () => {
  // Boot + import + edit + export + re-import is a long interaction on the
  // WebKit simulator; the default 30s budget expires mid-suite even when every
  // assertion is healthy.
  test.describe.configure({ timeout: 90_000 });
  test.use({ viewport: { width: 1920, height: 1080 } });
  // Project gate (plan §3.5.5): the round trip pins a 1920px desktop viewport
  // (its file download / re-import flow never varies by breakpoint), so the
  // mobile projects would only replay it under a phone UA. The touch-specific
  // mobile fix lives in the describe below on the mobile projects.
  test.skip(
    () => test.info().project.name.startsWith('mobile-'),
    'desktop-pinned round trip runs on the desktop project only',
  );

  test('import, edit, export: stlo, every attribute and the edits survive', async ({ page }) => {
    await page.goto('/');
    await importLorebook(page, FATE_PATH);

    await openFirstEntryOptions(page);

    // Inclusion group section: group label + weight.
    await page.getByLabel('Group', { exact: true }).fill(EDIT.group);
    await page.getByLabel('Group Weight').fill(EDIT.groupWeight);

    // Prioritize Inclusion chip.
    await page
      .getByRole('listbox', { name: 'Group selection mode' })
      .getByText('Prioritize Inclusion')
      .click();

    // Use Group Scoring tri-state select.
    await page.getByLabel('Use Group Scoring').click();
    await page.getByRole('option', { name: 'Enabled' }).click();

    // Ignore Budget chip in the activation section.
    await page
      .getByRole('listbox', { name: 'Execution modifiers' })
      .getByText('Ignore Budget')
      .click();

    const exported = await exportWorldInfo(page);
    const out = exported.json as {
      stlo?: Record<string, unknown>;
      entries: Record<string, Record<string, unknown>>;
    };

    // 1. Unmanaged book metadata rides along untouched.
    expect(out['stlo']).toEqual(original.stlo);

    // 2. Every original attribute of every entry survives the round trip
    //    (the export may add normalized defaults, never drop or change).
    //    The one entry edited through the UI is asserted separately below.
    const isEdited = (entry: Record<string, unknown>): boolean =>
      entry['group'] === EDIT.group && String(entry['groupWeight']) === EDIT.groupWeight;
    const losses: string[] = [];
    for (const [uid, sourceEntry] of Object.entries(original.entries)) {
      const entry = out.entries[uid];
      if (!entry) {
        losses.push(`uid ${uid} missing`);
        continue;
      }
      if (isEdited(entry)) {
        continue;
      }
      for (const [key, expected] of Object.entries(sourceEntry)) {
        if (JSON.stringify(entry[key]) !== JSON.stringify(expected)) {
          losses.push(
            `uid ${uid} ${key}: ${JSON.stringify(expected)} -> ${JSON.stringify(entry[key])}`,
          );
        }
      }
    }
    expect(losses, 'attributes lost in the round trip').toEqual([]);

    // 3. Exactly one entry carries the UI edits.
    const edited = Object.values(out.entries).filter(isEdited);
    expect(edited).toHaveLength(1);
    const editedEntry = edited[0];
    assert(editedEntry, 'expected the UI-edited entry in the export');
    expect(editedEntry['groupOverride']).toBe(true);
    expect(editedEntry['useGroupScoring']).toBe(true);
    expect(editedEntry['ignoreBudget']).toBe(true);

    // 4. The export re-imports through the UI and the edits are still there.
    const reimportChooser = page.waitForEvent('filechooser');
    await page.locator('[aria-label="Projects menu"]').click();
    await page.getByText('Open .json / .stproj').click();
    await (await reimportChooser).setFiles(await exported.download.path());
    await expect(page.locator('[aria-label="More actions menu"]')).toBeVisible();
    await expect(page.locator('.entries-sidenav')).toBeAttached();

    await openFirstEntryOptions(page);
    await expect(page.getByLabel('Group', { exact: true })).toHaveValue(EDIT.group);
    await expect(page.getByLabel('Group Weight')).toHaveValue(EDIT.groupWeight);
    await expect(
      page.getByRole('option', { name: 'Prioritize Inclusion' }).first(),
    ).toHaveAttribute('aria-selected', 'true');
  });

  test('wrapped content survives the import/edit/export round trip', async ({ page }) => {
    await page.goto('/');
    await importLorebook(page, FATE_PATH);

    await openFirstEntryOptions(page);

    // Replace the fixture's content with an already-wrapped body. The studio
    // must not re-wrap, strip, or otherwise normalize it on the way out.
    const wrapped = '<London>\nA wrapped body line.\n</London>';
    await page.locator('[aria-label="Entry content"]').fill(wrapped);
    await expect(page.locator('[aria-label="Entry content"]')).toHaveValue(wrapped);

    const exported = await exportWorldInfo(page);
    const out = exported.json as {
      entries: Record<string, Record<string, unknown>>;
    };

    // Exactly one entry carries the wrapped content, byte for byte.
    const contented = Object.values(out.entries).filter((entry) => entry['content'] === wrapped);
    expect(contented).toHaveLength(1);

    // Re-importing the export keeps the wrapper untouched in the editor.
    const reimportChooser = page.waitForEvent('filechooser');
    await page.locator('[aria-label="Projects menu"]').click();
    await page.getByText('Open .json / .stproj').click();
    await (await reimportChooser).setFiles(await exported.download.path());
    await expect(page.locator('[aria-label="More actions menu"]')).toBeVisible();
    await expect(page.locator('.entries-sidenav')).toBeAttached();

    await openFirstEntryOptions(page);
    await expect(page.locator('[aria-label="Entry content"]')).toHaveValue(wrapped);
  });

  test('welcome screen offers the theme menu before any project exists', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('app-welcome-screen')).toBeVisible();

    const themeButton = page.locator('[aria-label="Theme menu"]');
    await expect(themeButton).toBeVisible();
    await themeButton.click();
    await page.getByText('Dark — cyan orange').click();
    await expect(page.locator('html')).toHaveClass(/theme-dark/);
  });

  test('tooltips never trap the pointer', async ({ page }) => {
    await page.goto('/');
    // Hover a tooltip host; the floating bubble overlaps the content below
    // it, so it must be pointer-transparent (moving the cursor down from an
    // icon button glides straight onto the element underneath).
    await page.locator('[aria-label="Theme menu"]').hover();
    const panel = page.locator('.mat-mdc-tooltip-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toHaveClass(/mat-mdc-tooltip-panel-non-interactive/);
    const pointerEvents = await panel.evaluate((el) => getComputedStyle(el).pointerEvents);
    expect(pointerEvents).toBe('none');
  });
});

test.describe('touch scrolling in the entry list (mobile fix)', () => {
  // Pixel 7 preset: Android UA + touch. The Android platform flag is what
  // makes Material apply its touch-gesture handling, so this test is only
  // meaningful with a real mobile device descriptor. (`defaultBrowserType`
  // would force a new worker; the project is already pinned to Chromium.)
  const { defaultBrowserType: _browser, ...pixel7 } = devices['Pixel 7'];
  test.use(pixel7);
  // Project gate (plan §3.5.5): a mobile-device leg by design — the Android
  // UA/touch flags are the point, so the desktop project would only weaken
  // them; both mobile projects keep it (WebKit parity).
  test.skip(
    () => test.info().project.name === 'desktop-chrome',
    'touch-scrolling fix runs on the mobile projects only',
  );

  test('no tooltip host inside an entry row blocks native panning', async ({ page }) => {
    await page.goto('/');
    await importLorebook(page, FATE_PATH);

    // Open the entries drawer (off-canvas on mobile).
    await page.locator('[aria-label="Toggle entries panel"]').click();
    await expect(page.locator('.entry-item').first()).toBeVisible();

    // Material's `auto` tooltips stamp `touch-action: none` on every host,
    // which made any touch starting on a row unable to scroll the list.
    const blocked = await page.evaluate(() => {
      const hosts = document.querySelectorAll<HTMLElement>('.entry-item .mat-mdc-tooltip-trigger');
      return [...hosts].filter((el) => getComputedStyle(el).touchAction === 'none').length;
    });
    expect(blocked, 'tooltip hosts with touch-action: none inside rows').toBe(0);
  });
});
