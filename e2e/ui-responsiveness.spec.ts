import { devices, expect, type Page, test } from '@playwright/test';

/**
 * Responsive architecture suite for the LoreStitch studio shell.
 *
 * Verifies the M3 responsive rules across the canonical breakpoints:
 * - Desktop (>= 1280px): entries + history docked side-by-side, never
 *   overlapping the central editor.
 * - Tablet (768px–1279px): entries stay docked, history collapses into an
 *   overlay drawer toggled from the top bar.
 * - Mobile (< 768px): both panels become off-canvas overlay drawers driven by
 *   the hamburger and history buttons, no horizontal overflow anywhere, the
 *   editor scrolls independently of its header and 48px touch targets.
 */

type Viewport = {
  name: string;
  width: number;
  height: number;
  kind: 'desktop' | 'tablet' | 'mobile';
  /** Real device descriptor (touch, mobile media, UA) for phone viewports. */
  device?: keyof typeof devices;
};

const VIEWPORTS: Viewport[] = [
  { name: 'desktop-1920x1080', width: 1920, height: 1080, kind: 'desktop' },
  { name: 'desktop-1280x800', width: 1280, height: 800, kind: 'desktop' },
  { name: 'tablet-768x1024', width: 768, height: 1024, kind: 'tablet' },
  { name: 'mobile-390x844', width: 390, height: 844, kind: 'mobile', device: 'iPhone 13' },
  { name: 'mobile-412x915', width: 412, height: 915, kind: 'mobile', device: 'Pixel 7' },
];

const LONG_CONTENT = Array.from(
  { length: 60 },
  (_, i) =>
    `Entry line ${i}: Gensokyo is modern but sealed; villagers trade, youkai visit, ` +
    'incidents end over tea, and danmaku can be playful under fragile rules.',
).join('\n');

/** Creates a project through the welcome screen so the studio shell appears. */
async function createProject(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel('Project title').fill('E2E Lorebook');
  await page.getByRole('button', { name: 'Create Project' }).click();
  await expect(page.locator('.entries-sidenav')).toBeAttached();
}

/** Ensures the entries panel is reachable, then adds an entry (opens its tab). */
async function addEntry(page: Page, kind: Viewport['kind']): Promise<void> {
  const listAddButton = page.locator('app-entry-list [aria-label="New entry"]');
  if (kind === 'mobile') {
    // Open the drawer only when it is not already on-canvas (the caller may
    // have opened it to assert the drawer behavior).
    if (!(await listAddButton.isVisible())) {
      await page.locator('[aria-label="Toggle entries panel"]').click();
    }
    await expect(listAddButton).toBeVisible();
  }
  await listAddButton.click();
  // The new entry opens as the active editor tab.
  await expect(page.locator('app-entry-editor .entry-tabs')).toBeVisible();
  if (kind === 'mobile') {
    // Release the overlay drawer (focus is inside it) so the editor canvas is
    // interactive again; the backdrop's center is hidden under the panel on
    // narrow screens, so the Escape path is the reliable one.
    await page.keyboard.press('Escape');
    await expect(page.locator('.entries-sidenav')).not.toBeInViewport();
  }
}

/** Opens the on-canvas history drawer (overlay on tablet/mobile). */
async function openHistory(page: Page): Promise<void> {
  await page.locator('[aria-label="Toggle history drawer"]').click();
  await expect(page.locator('.history-sidenav')).toBeInViewport();
}

test.describe('responsive studio shell', () => {
  for (const vp of VIEWPORTS) {
    test.describe(`${vp.name} (${vp.kind})`, () => {
      // The device preset's `defaultBrowserType` would force a new worker;
      // the suite is already pinned to Chromium in the config's project.
      if (vp.device) {
        const { defaultBrowserType: _browser, ...device } = devices[vp.device];
        test.use(device);
      } else {
        test.use({ viewport: { width: vp.width, height: vp.height } });
      }

      test('top bar never causes horizontal overflow', async ({ page }) => {
        await createProject(page);
        await addEntry(page, vp.kind);

        const overflow = await page.evaluate(() => ({
          document:
            document.documentElement.scrollWidth - document.documentElement.clientWidth,
          body: document.body.scrollWidth - document.body.clientWidth,
          topbar:
            document.querySelector('.topbar')!.scrollWidth -
            document.querySelector('.topbar')!.clientWidth,
        }));
        expect(overflow.document, 'document must not scroll horizontally').toBeLessThanOrEqual(0);
        expect(overflow.body, 'body must not scroll horizontally').toBeLessThanOrEqual(0);
        expect(overflow.topbar, 'top bar content must not clip sideways').toBeLessThanOrEqual(0);
      });

      if (vp.kind === 'desktop') {
        test('entries and history dock side-by-side without overlapping the editor', async ({
          page,
        }) => {
          await createProject(page);
          await addEntry(page, vp.kind);

          const entries = page.locator('.entries-sidenav');
          const history = page.locator('.history-sidenav');
          await expect(entries).toHaveClass(/mat-drawer-side/);
          await expect(history).toHaveClass(/mat-drawer-side/);

          const entriesBox = (await entries.boundingBox())!;
          const editorBox = (await page.locator('.editor-content').boundingBox())!;
          const historyBox = (await history.boundingBox())!;
          expect(entriesBox.x + entriesBox.width).toBeLessThanOrEqual(editorBox.x + 1);
          expect(editorBox.x + editorBox.width).toBeLessThanOrEqual(historyBox.x + 1);

          // Both panels are on-canvas at once.
          await expect(entries).toBeInViewport();
          await expect(history).toBeInViewport();
        });
      }

      if (vp.kind === 'tablet') {
        test('entries stay docked while history collapses to an overlay drawer', async ({
          page,
        }) => {
          await createProject(page);
          await addEntry(page, vp.kind);

          const entries = page.locator('.entries-sidenav');
          const history = page.locator('.history-sidenav');
          await expect(entries).toHaveClass(/mat-drawer-side/);
          await expect(history).toHaveClass(/mat-drawer-over/);

          // Entries docked; history off-canvas until toggled.
          await expect(entries).toBeInViewport();
          await expect(history).not.toBeInViewport();
          await openHistory(page);
          // The overlay drawer covers the canvas without pushing it.
          const editorBox = (await page.locator('.editor-content').boundingBox())!;
          expect(editorBox.x).toBeGreaterThanOrEqual(
            (await page.locator('.entries-sidenav').boundingBox())!.x,
          );
        });
      }

      if (vp.kind === 'mobile') {
        test('both panels are off-canvas drawers driven from the top bar', async ({ page }) => {
          await createProject(page);

          const entries = page.locator('.entries-sidenav');
          const history = page.locator('.history-sidenav');
          await expect(entries).toHaveClass(/mat-drawer-over/);
          await expect(history).toHaveClass(/mat-drawer-over/);
          await expect(entries).not.toBeInViewport();
          await expect(history).not.toBeInViewport();

          // Hamburger opens the entries navigation.
          await page.locator('[aria-label="Toggle entries panel"]').click();
          await expect(entries).toBeInViewport();
          await expect(page.getByRole('heading', { name: 'Entries' })).toBeVisible();

          await addEntry(page, vp.kind);
          await openHistory(page);
          await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();
        });

        test('icon buttons meet the 48px minimum touch target', async ({ page }) => {
          await createProject(page);

          const sizes = await page.evaluate(() => {
            const buttons = [
              ...document.querySelectorAll<HTMLElement>('.topbar .mat-mdc-icon-button'),
            ];
            return buttons.map((b) => {
              const box = b.getBoundingClientRect();
              return { width: box.width, height: box.height };
            });
          });
          expect(sizes.length).toBeGreaterThan(0);
          for (const size of sizes) {
            expect(size.width).toBeGreaterThanOrEqual(48);
            expect(size.height).toBeGreaterThanOrEqual(48);
          }
        });

        test('entry row actions are visible without hover', async ({ page }) => {
          await createProject(page);
          await addEntry(page, vp.kind);

          await page.locator('[aria-label="Toggle entries panel"]').click();
          await expect(page.getByRole('heading', { name: 'Entries' })).toBeVisible();

          // Touch has no hover: duplicate/delete must be painted, inside the
          // row, and reachable without scrolling the list sideways.
          const duplicate = page
            .locator('app-entry-list [aria-label="Duplicate entry"]')
            .first();
          await expect(duplicate).toBeVisible();
          await expect(duplicate).toHaveCSS('opacity', '1');
          const dupBox = (await duplicate.boundingBox())!;
          const rowBox = (await page
            .locator('app-entry-list .entry-item')
            .first()
            .boundingBox())!;
          expect(dupBox.x + dupBox.width).toBeLessThanOrEqual(rowBox.x + rowBox.width + 1);
          const docOverflow = await page.evaluate(
            () =>
              document.documentElement.scrollWidth - document.documentElement.clientWidth,
          );
          expect(docOverflow).toBeLessThanOrEqual(0);
        });
      }

      test('editor body scrolls independently without clipping the tab strip', async ({
        page,
      }) => {
        await createProject(page);
        await addEntry(page, vp.kind);

        const content = page.locator('[aria-label="Entry content"]');
        await content.fill(LONG_CONTENT);

        // The writing well is the scroll surface at every breakpoint; the tab
        // strip above it must stay in place while it scrolls.
        if (vp.kind === 'mobile') {
          const well = await content.boundingBox();
          expect(well!.height).toBeGreaterThanOrEqual(220);
        }
        const scrollable = await content.evaluate(
          (el) => el.scrollHeight > el.clientHeight,
        );
        expect(scrollable, 'content should overflow into its own scroll').toBe(true);
        await content.evaluate((el) => (el.scrollTop = el.scrollHeight));
        await expect(page.locator('.mat-mdc-tab-header')).toBeInViewport();
      });

      test('long entry names and key chips keep row actions inside the panel', async ({
        page,
      }) => {
        await createProject(page);
        await addEntry(page, vp.kind);

        // Reproduce an imported-lorebook row: a long nowrap title plus enough
        // keys to render three chips and a "+N" badge.
        await page
          .locator('input[placeholder="Entry name…"]')
          .last()
          .fill('Human Servant Status & The Edicts of Camelot Concerning Peerage');
        await page.locator('[aria-label="Toggle entry options"]').click();
        const keyInput = page.getByPlaceholder('Add key…').last();
        await keyInput.waitFor({ state: 'visible' });
        for (const key of ['human', 'humans', 'servant', 'camelot', 'peerage', 'edict']) {
          await keyInput.fill(key);
          await keyInput.press('Enter');
        }
        await page.locator('[aria-label="Toggle entry options"]').click();

        if (vp.kind === 'mobile') {
          await page.locator('[aria-label="Toggle entries panel"]').click();
          await expect(page.getByRole('heading', { name: 'Entries' })).toBeVisible();
          // Let the slide-in transition finish before measuring boxes.
          await page.waitForTimeout(600);
        }

        // The virtual-scroll content wrapper must never exceed the panel, or
        // the duplicate/delete actions end up clipped off-canvas.
        const scroll = await page.locator('.list-viewport').evaluate((el) => ({
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
        }));
        expect(scroll.scrollWidth).toBeLessThanOrEqual(scroll.clientWidth + 1);

        const panelBox = (await page.locator('.entries-sidenav').boundingBox())!;
        const rowBox = (await page.locator('app-entry-list .entry-item').first().boundingBox())!;
        expect(rowBox.x).toBeGreaterThanOrEqual(panelBox.x);
        expect(rowBox.x + rowBox.width).toBeLessThanOrEqual(panelBox.x + panelBox.width + 1);

        const duplicate = page
          .locator('app-entry-list [aria-label="Duplicate entry"]')
          .first();
        const dupBox = (await duplicate.boundingBox())!;
        expect(dupBox.x + dupBox.width).toBeLessThanOrEqual(panelBox.x + panelBox.width + 1);
      });

      test('no element overflows the viewport width', async ({ page }) => {
        await createProject(page);
        await addEntry(page, vp.kind);
        // Open the options panel to check the expanded layout too.
        await page.locator('[aria-label="Toggle entry options"]').click();

        const scan = () =>
          page.evaluate(() => {
            const docWidth = document.documentElement.clientWidth;
            const bad: string[] = [];
            for (const el of document.querySelectorAll<HTMLElement>('body *')) {
              // Closed off-canvas drawers are intentionally outside the viewport.
              if (el.closest('.mat-drawer:not(.mat-drawer-opened)')) continue;
              if (el.closest('.cdk-overlay-container')) continue;
              const style = getComputedStyle(el);
              if (style.position === 'fixed' || style.visibility === 'hidden') continue;
              if (el.classList.contains('cdk-visually-hidden')) continue;
              const box = el.getBoundingClientRect();
              if (box.width > 0 && (box.right > docWidth + 1 || box.left < -1)) {
                bad.push(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')}`);
              }
            }
            return bad.slice(0, 5);
          });

        // Poll instead of scanning once: drawer/panel animations legitimately
        // put elements outside the viewport for a few frames, but nothing may
        // stay there.
        await expect
          .poll(scan, { timeout: 5_000, message: 'persistent viewport overflow' })
          .toEqual([]);
      });
    });
  }
});
