import { devices, expect, type Page, test } from '@playwright/test';
import { strict as assert } from 'node:assert';
import { join } from 'node:path';

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

interface Viewport {
  name: string;
  width: number;
  height: number;
  kind: 'desktop' | 'tablet' | 'mobile';
  /** Real device descriptor (touch, mobile media, UA) for phone viewports. */
  device?: keyof typeof devices;
}

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

/** Many-entry lorebook used to exercise the virtualized entry list. */
const EXAMPLE_LOREBOOK = join(
  process.cwd(),
  'example_card',
  'Fate Stay Night - Fuyuki Lorebook(1).json',
);

/** Creates a project through the welcome screen so the studio shell appears. */
async function createProject(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel('Project title').fill('E2E Lorebook');
  await page.getByRole('button', { name: 'Create Project' }).click();
  // Assert the project-open top bar, not merely an attached sidenav: the
  // welcome state also renders a sidenav, so a silently failed creation
  // would otherwise slip through and poison later top-bar measurements.
  await expect(page.locator('[aria-label="More actions menu"]')).toBeVisible();
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
        const descriptor = devices[vp.device];
        assert(descriptor, `unknown device preset: ${vp.device}`);
        const { defaultBrowserType: _browser, ...device } = descriptor;
        test.use(device);
      } else {
        test.use({ viewport: { width: vp.width, height: vp.height } });
      }

      test('top bar never causes horizontal overflow', async ({ page }) => {
        await createProject(page);
        await addEntry(page, vp.kind);

        const overflow = await page.evaluate(() => {
          const topbar = document.querySelector('.topbar');
          if (!topbar) {
            throw new Error('.topbar not rendered');
          }
          return {
            document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            body: document.body.scrollWidth - document.body.clientWidth,
            topbar: topbar.scrollWidth - topbar.clientWidth,
          };
        });
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

          const entriesBox = await entries.boundingBox();
          assert(entriesBox, 'entries panel has no bounding box');
          const editorBox = await page.locator('.editor-content').boundingBox();
          assert(editorBox, 'editor has no bounding box');
          const historyBox = await history.boundingBox();
          assert(historyBox, 'history panel has no bounding box');
          expect(entriesBox.x + entriesBox.width).toBeLessThanOrEqual(editorBox.x + 1);
          expect(editorBox.x + editorBox.width).toBeLessThanOrEqual(historyBox.x + 1);

          // Both panels are on-canvas at once.
          await expect(entries).toBeInViewport();
          await expect(history).toBeInViewport();
        });

        test('focus mode narrows the editor and toggles back off', async ({ page }) => {
          await createProject(page);
          await addEntry(page, vp.kind);

          const toggle = page.locator('[aria-label="Toggle focus mode"]');
          await expect(toggle).toBeVisible();

          // On: the editor column is constrained to the reading measure.
          await toggle.click();
          await expect(toggle).toHaveAttribute('aria-pressed', 'true');
          const maxWidth = await page
            .locator('app-entry-editor')
            .evaluate((el) => getComputedStyle(el).maxWidth);
          expect(parseFloat(maxWidth)).toBeLessThanOrEqual(780);

          // Wide windows actually see the pane shrink to that measure.
          if (vp.width >= 1920) {
            const box = await page.locator('app-entry-editor').boundingBox();
            assert(box, 'editor has no bounding box');
            expect(box.width).toBeLessThanOrEqual(781);
          }

          // Off: the constraint is lifted.
          await toggle.click();
          await expect(toggle).toHaveAttribute('aria-pressed', 'false');
          const restored = await page
            .locator('app-entry-editor')
            .evaluate((el) => getComputedStyle(el).maxWidth);
          expect(restored).toBe('none');
        });
      } else {
        test('focus mode is not offered below desktop widths', async ({ page }) => {
          await createProject(page);
          await addEntry(page, vp.kind);
          await expect(page.locator('[aria-label="Toggle focus mode"]')).toHaveCount(0);
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
          const editorBox = await page.locator('.editor-content').boundingBox();
          assert(editorBox, 'editor has no bounding box');
          const entriesBox = await page.locator('.entries-sidenav').boundingBox();
          assert(entriesBox, 'entries panel has no bounding box');
          expect(editorBox.x).toBeGreaterThanOrEqual(entriesBox.x);
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

          // The 48dp contract covers only buttons a finger can actually tap.
          // Desktop-only actions are display:none at this width (they measure
          // 0x0), so they are asserted hidden below, never measured here.
          const { measured, visibleDesktopOnly } = await page.evaluate(() => {
            const buttons = [
              ...document.querySelectorAll<HTMLElement>('.topbar .mat-mdc-icon-button'),
            ];
            return {
              measured: buttons
                .filter((b) => b.checkVisibility())
                .map((b) => {
                  const box = b.getBoundingClientRect();
                  return { width: box.width, height: box.height };
                }),
              visibleDesktopOnly: buttons.filter(
                (b) => b.classList.contains('desktop-only') && b.checkVisibility(),
              ).length,
            };
          });
          expect(
            measured.length,
            'at least one top-bar icon button must be tappable',
          ).toBeGreaterThan(0);
          for (const size of measured) {
            expect(size.width).toBeGreaterThanOrEqual(48);
            expect(size.height).toBeGreaterThanOrEqual(48);
          }
          // Regression guard for the hiding behavior itself: the compact bar
          // drops the desktop-only actions instead of shrinking them, so a
          // CSS change that keeps them rendered must fail here.
          expect(visibleDesktopOnly, 'desktop-only buttons visible at phone width').toBe(0);
        });

        test('content delimiters dialog is full-screen with a readable diff', async ({ page }) => {
          await createProject(page);
          await addEntry(page, vp.kind);
          await page.locator('[aria-label="Entry content"]').fill(LONG_CONTENT);

          // Stress the short end of the compact class (landscape phones):
          // there the dialog content must overflow into a scroll instead of
          // squeezing the diff or clipping the actions.
          await page.setViewportSize({ width: vp.width, height: 500 });

          await page.locator('[aria-label="Content delimiters"]').click();
          const pane = page.locator('.cdk-overlay-pane.app-compact-fullscreen-dialog');
          await expect(pane).toBeVisible();

          // MD3 compact screens get the full-screen dialog, edge to edge.
          const box = await pane.boundingBox();
          assert(box, 'dialog pane has no bounding box');
          const viewport = page.viewportSize();
          assert(viewport, 'page has no viewport size');
          expect(box.width).toBeGreaterThanOrEqual(viewport.width - 1);
          expect(box.height).toBeGreaterThanOrEqual(viewport.height - 1);

          // The preview diff must keep its body instead of being squeezed down
          // to its toolbar by the dialog's flex column.
          const diffBody = pane.locator('app-diff-viewer .diff-body');
          await expect(diffBody).toBeVisible();
          const diffBox = await diffBody.boundingBox();
          assert(diffBox, 'diff body has no bounding box');
          expect(diffBox.height).toBeGreaterThan(50);

          // Long content overflows into the dialog content scroll, with the
          // actions still pinned in view.
          const scrollable = await pane
            .locator('.mat-mdc-dialog-content')
            .evaluate((el) => el.scrollHeight > el.clientHeight);
          expect(scrollable, 'dialog content should scroll').toBe(true);
          await expect(pane.getByRole('button', { name: /Apply/ })).toBeInViewport();
        });

        test('entry row actions are visible without hover', async ({ page }) => {
          await createProject(page);
          await addEntry(page, vp.kind);

          await page.locator('[aria-label="Toggle entries panel"]').click();
          await expect(page.getByRole('heading', { name: 'Entries' })).toBeVisible();

          // Touch has no hover: duplicate/delete must be painted, inside the
          // row, and reachable without scrolling the list sideways.
          const duplicate = page.locator('app-entry-list [aria-label="Duplicate entry"]').first();
          await expect(duplicate).toBeVisible();
          await expect(duplicate).toHaveCSS('opacity', '1');
          const dupBox = await duplicate.boundingBox();
          assert(dupBox, 'duplicate action has no bounding box');
          const rowBox = await page.locator('app-entry-list .entry-item').first().boundingBox();
          assert(rowBox, 'entry row has no bounding box');
          expect(dupBox.x + dupBox.width).toBeLessThanOrEqual(rowBox.x + rowBox.width + 1);
          const docOverflow = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          );
          expect(docOverflow).toBeLessThanOrEqual(0);
        });

        test('virtual entry list fills the drawer viewport once it opens', async ({ page }) => {
          // Import a many-entry lorebook straight from the welcome screen so
          // the list is created while the drawer is still off-canvas — the
          // exact condition under which the CDK viewport mis-measured.
          await page.goto('/');
          const [chooser] = await Promise.all([
            page.waitForEvent('filechooser'),
            page.getByRole('button', { name: 'Import .json / .stproj' }).first().click(),
          ]);
          await chooser.setFiles(EXAMPLE_LOREBOOK);
          await expect(page.locator('.entries-sidenav')).toBeAttached();
          await expect(page.locator('.project-badge', { hasText: 'Fuyuki' })).toBeVisible();

          await page.locator('[aria-label="Toggle entries panel"]').click();
          await expect(page.getByRole('heading', { name: 'Entries' })).toBeVisible();
          await expect(page.locator('app-entry-list .entry-item').first()).toBeVisible();

          // Rendered rows must reach the bottom of the scrollport, not stop
          // after the first few items with dead space below. The CDK viewport
          // re-measures once the drawer becomes visible (entry-list.ts), so
          // poll the fill instead of sleeping out a fixed settle time.
          await expect
            .poll(
              () =>
                page.evaluate(() => {
                  const viewport = document.querySelector('.list-viewport');
                  if (!viewport) {
                    throw new Error('.list-viewport not rendered');
                  }
                  const viewportBox = viewport.getBoundingClientRect();
                  const items = [...document.querySelectorAll('app-entry-list .entry-item')];
                  const lastBottom = Math.max(
                    -Infinity,
                    ...items.map((item) => item.getBoundingClientRect().bottom),
                  );
                  return viewportBox.height - (lastBottom - viewportBox.top);
                }),
              { timeout: 5_000, message: 'virtual list must fill the drawer viewport' },
            )
            .toBeLessThanOrEqual(8);

          const fill = await page.evaluate(() => {
            const viewport = document.querySelector('.list-viewport');
            if (!viewport) {
              throw new Error('.list-viewport not rendered');
            }
            return {
              rendered: document.querySelectorAll('app-entry-list .entry-item').length,
              available: viewport.getBoundingClientRect().height,
            };
          });
          expect(fill.rendered).toBeGreaterThan(4);
          expect(fill.available).toBeGreaterThan(200);
        });
      }

      test('editor body scrolls independently without clipping the tab strip', async ({ page }) => {
        await createProject(page);
        await addEntry(page, vp.kind);

        const content = page.locator('[aria-label="Entry content"]');
        await content.fill(LONG_CONTENT);

        // The writing well is the scroll surface at every breakpoint; the tab
        // strip above it must stay in place while it scrolls.
        if (vp.kind === 'mobile') {
          const well = await content.boundingBox();
          assert(well, 'entry content has no bounding box');
          expect(well.height).toBeGreaterThanOrEqual(220);
        }
        const scrollable = await content.evaluate((el) => el.scrollHeight > el.clientHeight);
        expect(scrollable, 'content should overflow into its own scroll').toBe(true);
        await content.evaluate((el) => (el.scrollTop = el.scrollHeight));
        await expect(page.locator('.mat-mdc-tab-header')).toBeInViewport();
      });

      test('long entry names and key chips keep row actions inside the panel', async ({ page }) => {
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
        }

        // Long titles and key chips now scroll the list viewport horizontally
        // instead of truncating, so the containment contract changed: the
        // overflow must stay inside the list viewport (never reach the page),
        // and scrolling to the far right must bring the duplicate/delete
        // actions fully into view. Poll instead of sleeping out the drawer's
        // slide-in transition: intermediate animation frames can transiently
        // mis-measure.
        await expect
          .poll(
            () =>
              page.evaluate(() => {
                const query = (selector: string): Element => {
                  const el = document.querySelector(selector);
                  if (!el) {
                    throw new Error(`${selector} not rendered`);
                  }
                  return el;
                };
                const doc = document.documentElement;
                const viewport = query('.list-viewport');
                const pageOverflow = doc.scrollWidth - doc.clientWidth;
                // Scrolling the viewport to its end must reveal the row
                // actions; a boolean is enough — pixel-perfect alignment is
                // not part of the contract.
                viewport.scrollLeft = viewport.scrollWidth;
                const viewportRect = viewport.getBoundingClientRect();
                const duplicate = query(
                  'app-entry-list [aria-label="Duplicate entry"]',
                ).getBoundingClientRect();
                const actionsReachable =
                  duplicate.right <= viewportRect.right + 1 &&
                  duplicate.left >= viewportRect.left - 1;
                viewport.scrollLeft = 0;
                return actionsReachable ? pageOverflow : 1;
              }),
            {
              timeout: 5_000,
              message:
                'row actions must stay reachable via horizontal scroll and overflow must not leak to the page',
            },
          )
          .toBeLessThanOrEqual(0);
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
