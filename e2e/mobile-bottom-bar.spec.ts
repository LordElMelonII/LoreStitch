import { expect, type Locator, type Page, test } from '@playwright/test';
import { FATE_PATH, importLorebook } from './helpers';

/**
 * M3 bottom action bar guardrails (task 02 plan §3.5, re-pointed from the
 * retired FAB to the bar).
 *
 * The bar is the phone entry point for the core actions (New entry, Search &
 * replace, Export, Batch edit, History — the last moved off the mobile
 * topbar). Contract under test:
 * - renders only on phones (<768px) with an open project and nothing
 *   covering it (no dialog/sheet, no drawer);
 * - hosts exactly the five labeled quick actions;
 * - its Export item opens the shared five-format export menu UPWARD;
 * - its History item opens the over-drawer, and the bar unstamps itself for
 *   as long as a drawer or any dialog/sheet covers the app;
 * - every item meets the enhanced 48px mobile touch target.
 *
 * The two describes mirror `about-dialog.spec.ts`'s breakpoint gating: each
 * targets one side of the 768px shell breakpoint and skips the other, so the
 * config's three projects cover both sides with focused runs.
 */

/** The bar host (always mounted; its content stamps only while visible). */
function barHost(page: Page): Locator {
  return page.locator('app-mobile-bottom-bar');
}

/** The bar's nav — present in the DOM only while the bar is shown. */
function barNav(page: Page): Locator {
  return barHost(page).locator('nav[aria-label="Quick actions"]');
}

test.describe('mobile bottom action bar (phones)', () => {
  test.skip(
    ({ viewport }) => (viewport?.width ?? 0) >= 768,
    'the bar only renders below the 768px shell breakpoint',
  );
  // Import + WebKit drawer choreography can exceed the default budget.
  test.describe.configure({ timeout: 60_000 });

  test('shows five labeled quick actions for an open project only', async ({ page }) => {
    // No project open: the welcome screen has no bar to decorate.
    await page.goto('/');
    await expect(page.locator('app-welcome-screen')).toBeVisible();
    await expect(barNav(page)).toHaveCount(0);

    await page.goto('/');
    await importLorebook(page, FATE_PATH);
    await expect(barNav(page)).toBeVisible();
    await expect(barHost(page).locator('.bar-item')).toHaveCount(5);

    // Visible labels plus the full accessible names (the Search item shows
    // the M3 navigation-bar style short label but carries the full
    // aria-label; History is named by its aria-label).
    for (const name of ['New entry', 'Search & replace', 'Export', 'Batch edit', 'Toggle history drawer']) {
      await expect(barNav(page).getByRole('button', { name, exact: true })).toBeVisible();
    }

    // The History affordance left the phone topbar with the bar as its home:
    // exactly one "Toggle history drawer" control exists per breakpoint side.
    await expect(
      page.locator('mat-toolbar button[aria-label="Toggle history drawer"]'),
    ).toHaveCount(0);
  });

  test('the New entry action creates an entry and opens its editor tab', async ({ page }) => {
    await page.goto('/');
    await importLorebook(page, FATE_PATH);
    const countBefore = Number(await page.locator('.list-header .count').textContent());
    const tabsBefore = await page.locator('.entry-tabs .mat-mdc-tab').count();

    await barNav(page).getByRole('button', { name: 'New entry', exact: true }).click();

    // The editor gains a tab for the fresh entry and the sidebar header's
    // entry count increments (the drawer is off-canvas, but its header stays
    // stamped — the count is read from the DOM, not the viewport).
    await expect(
      page.locator('.entry-tabs .mat-mdc-tab', { hasText: 'New entry' }),
    ).toHaveCount(1);
    await expect(page.locator('.entry-tabs .mat-mdc-tab')).toHaveCount(tabsBefore + 1);
    await expect(page.locator('.list-header .count')).toHaveText(String(countBefore + 1));
  });

  test('the Export action opens the shared export menu above the bar', async ({ page }) => {
    await page.goto('/');
    await importLorebook(page, FATE_PATH);

    await barNav(page).getByRole('button', { name: 'Export', exact: true }).click();
    const panel = page.locator('.mat-mdc-menu-panel.export-menu');
    await expect(panel).toBeVisible();

    // The same five formats the topbar export menu offers.
    for (const title of [
      'World Info JSON',
      'Project archive (.stproj)',
      'Export selected entries…',
      'Character Book JSON',
      'Proofread digest (Markdown)',
    ]) {
      await expect(panel.locator('.menu-title', { hasText: title })).toBeVisible();
    }

    // Docked to the viewport's bottom edge, the panel must open UPWARD: its
    // bottom edge stays at/above the bar's top edge (2px subpixel tolerance).
    const edges = await page.evaluate(() => {
      const panelBox = document
        .querySelector('.mat-mdc-menu-panel.export-menu')
        ?.getBoundingClientRect();
      const barBox = document.querySelector('app-mobile-bottom-bar')?.getBoundingClientRect();
      if (!panelBox) {
        throw new Error('export menu panel not rendered');
      }
      if (!barBox) {
        throw new Error('bottom bar host not rendered');
      }
      return { panelBottom: panelBox.bottom, barTop: barBox.top };
    });
    expect(edges.panelBottom).toBeLessThanOrEqual(edges.barTop + 2);

    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    // The menu is not an overlay in ResponsiveOverlayService's sense: the
    // bar stays mounted beneath its own trigger.
    await expect(barNav(page)).toBeVisible();
  });

  test('the History action opens the drawer and the bar hides while it is open', async ({
    page,
  }) => {
    await page.goto('/');
    await importLorebook(page, FATE_PATH);
    await expect(barNav(page)).toBeVisible();

    await barNav(page).getByRole('button', { name: 'Toggle history drawer' }).click();
    const history = page.locator('.history-sidenav');
    await expect(history).toBeInViewport();
    await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();

    // An over-drawer's scrim cannot cover the bar (it lives outside the
    // sidenav container), so the bar unstamps its content instead of showing
    // UI that looks reachable but is not.
    await expect(barNav(page)).toHaveCount(0);

    // Closing the drawer hands the bottom row back to the bar. The drawer's
    // Escape listener sits on the drawer element itself, so the keydown must
    // bubble from inside it (a phone user closes it with a backdrop tap;
    // the unstamped bar dropped the previous focus to <body>). Focus the
    // pane first — what a tap into the drawer does — then press Escape.
    await history.focus();
    await page.keyboard.press('Escape');
    await expect(history).not.toBeInViewport();
    await expect(barNav(page)).toBeVisible();
  });

  test('any dialog hides the bar while open and returns it after close', async ({ page }) => {
    await page.goto('/');
    await importLorebook(page, FATE_PATH);
    await expect(barNav(page)).toBeVisible();

    // About via the More menu: on phones it opens as the About bottom sheet.
    await page.locator('[aria-label="More actions menu"]').click();
    await page.getByRole('menuitem', { name: 'About LoreStitch…' }).click();
    const pane = page.locator('.cdk-overlay-pane.app-about-sheet');
    await expect(pane).toBeVisible();
    await expect(barNav(page)).toHaveCount(0);

    await pane.getByRole('button', { name: 'Close about' }).click();
    await expect(pane).toBeHidden();
    await expect(barNav(page)).toBeVisible();
  });

  // The bar items' 48px touch-target check lives in ui-responsiveness.spec.ts
  // ("rows, batch controls, accordion strip and bar items…"), which measures
  // the same five `.bar-item`s alongside the other mobile surfaces.
});

test.describe('mobile bottom action bar (tablet/desktop absence)', () => {
  test.skip(
    ({ viewport }) => (viewport?.width ?? 0) < 768,
    'the bar must never render at viewport widths >= 768px',
  );

  test('no bottom bar while a project is open, and history stays in the topbar', async ({
    page,
  }) => {
    await page.goto('/');
    await importLorebook(page, FATE_PATH);

    // The host may stay mounted (its hidden state is display:none), but the
    // bar content itself must not stamp at docked-panel widths.
    await expect(barNav(page)).toHaveCount(0);
    await expect(barHost(page).locator('.bar-item')).toHaveCount(0);

    // The History affordance belongs to the topbar from 768px up.
    await expect(
      page.locator('mat-toolbar button[aria-label="Toggle history drawer"]'),
    ).toBeVisible();
  });
});
