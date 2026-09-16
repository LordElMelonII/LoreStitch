import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Captures the ROADMAP high-priority feature UI states as PNGs for visual
 * review, on desktop (1440x900) and mobile (390x844) viewports. Run with a
 * dev server already listening on 4301:
 *   node scripts/capture-feature-shots.mjs
 */
const BASE = 'http://127.0.0.1:4301';
const OUT = join(process.cwd(), 'test-results', 'feature-shots');
mkdirSync(OUT, { recursive: true });

const FATE_PATH = join(process.cwd(), 'example_card', 'Fate Stay Night - Fuyuki Lorebook(1).json');

const browser = await chromium.launch();

/** Shoots the four feature states for one viewport class. */
async function capture(prefix, viewport) {
  const page = await browser.newPage({ viewport });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const importChooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import .json / .stproj' }).click();
  await (await importChooser).setFiles(FATE_PATH);

  // On mobile the entries drawer starts closed and its rows stay hidden
  // until it opens — open it before waiting for rows.
  if (prefix === 'mobile') {
    await page.locator('[aria-label="Toggle entries panel"]').click();
  }
  await page.waitForSelector('.entry-item', { timeout: 30_000 });
  if (prefix === 'mobile') {
    await page.waitForTimeout(500);
  }
  // Let the import snackbar expire so it never photobombs the shots.
  await page.waitForTimeout(4200);

  // 1. Shell with token meter + selection/batch bar visible.
  await page.locator('.entry-item').first().locator('.row-select').click();
  await page.locator('.entry-item').nth(1).locator('.row-select').click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, `${prefix}-1-shell-selection.png`) });

  // 2. Batch operations dialog with a few ops set.
  await page.locator('[aria-label="Batch edit selection"]').click();
  await page.waitForSelector('mat-dialog-container');
  await page.getByRole('radio', { name: 'Disable' }).click();
  await page.getByRole('radio', { name: 'Set to' }).click();
  await page.waitForTimeout(400);
  // Clicking the toggles may scroll the dialog content; restore the top so
  // the hint line is in frame.
  await page.locator('mat-dialog-content').evaluate((el) => (el.scrollTop = 0));
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(OUT, `${prefix}-2-batch-dialog.png`) });
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.waitForSelector('mat-dialog-container', { state: 'detached' });
  await page.waitForTimeout(300);

  // 3. Token inspector dialog.
  await page.locator('[aria-label*="Always active token footprint"]').click();
  await page.waitForSelector('mat-dialog-container');
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, `${prefix}-3-token-inspector.png`) });
  await page.getByRole('button', { name: 'Done' }).click();
  await page.waitForSelector('mat-dialog-container', { state: 'detached' });
  await page.waitForTimeout(300);

  // 4. Export-selected dialog (selection persisted through the dialogs).
  await page.locator('[aria-label="Export selection as lorebook"]').click();
  await page.waitForSelector('mat-dialog-container');
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, `${prefix}-4-export-selected.png`) });

  await page.close();
}

await capture('desktop', { width: 1440, height: 900 });
await capture('mobile', { width: 390, height: 844 });

await browser.close();
console.log(`Saved screenshots to ${OUT}`);
