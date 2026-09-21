import { expect, type Locator, type Page, test } from '@playwright/test';
import { FATE_PATH, importLorebook, selectFirstTwoRows } from './helpers';

/**
 * M3 bottom action bar guardrails (task 02 plan §3.5, re-pointed from the
 * retired FAB to the bar; amended by task 06 — the bar never unstamps for as
 * long as a phone session has an open project).
 *
 * The bar is the phone entry point for the core actions (New entry, Search &
 * replace, Export, Batch edit, History — the last moved off the mobile
 * topbar). Contract under test (task 06 §3.2):
 * - renders only on phones (<768px) with an open project, mounted ONCE
 *   through drawers, sheets and dialogs — nothing tears the 64px row down
 *   (the open/close reflow stutter the always-docked rule removed);
 * - hosts exactly the five labeled quick actions;
 * - while a drawer overlays the editor the bar lowers to `backgrounded`:
 *   its content goes `[inert]` and a scrim veil covers the host — the look
 *   the strip cannot inherit (a drawer's scrim is clipped to the sidenav
 *   container above it); tapping a bar item is a no-op in that state;
 * - while the open entries drawer holds a selection the bar swaps its five
 *   items for the entry-list batch toolbar transplanted into the strip
 *   (`div.batch-bar[role=toolbar][aria-label="Batch actions"]`) — foreground,
 *   fully interactive, and the ONLY batch toolbar on a phone;
 * - full-viewport CDK overlays (dialogs, sheets, menus) cover and dim the
 *   strip themselves — the bar pins no state around them;
 * - its Export item opens the shared five-format export menu UPWARD;
 * - the shell's phone pane-focus policy focuses the drawer pane on open, so
 *   Escape closes the drawer from every open path (no lost-focus workaround);
 * - every item and swapped control meets the enhanced 48px mobile touch
 *   target.
 *
 * The two describes mirror `about-dialog.spec.ts`'s breakpoint gating: each
 * targets one side of the 768px shell breakpoint and skips the other, so the
 * config's three projects cover both sides with focused runs.
 */

/** The bar host — mounted on a phone session the entire time, docked at the
 * viewport's bottom edge; only its content branches by bar state. */
function barHost(page: Page): Locator {
  return page.locator('app-mobile-bottom-bar');
}

/** The bar's quick-action nav — the `normal`/`backgrounded` content row. */
function barNav(page: Page): Locator {
  return barHost(page).locator('nav[aria-label="Quick actions"]');
}

/**
 * The transplanted batch toolbar inside the bar (`batch` state) — the same
 * `.batch-bar` DOM contract the header toolbar keeps at docked-panel widths,
 * and the ONLY batch toolbar a phone can ever show (the header's toolbar
 * renders at >=768px widths, where no bar exists).
 */
function barBatchToolbar(page: Page): Locator {
  return barHost(page).locator('.batch-bar[role="toolbar"][aria-label="Batch actions"]');
}

/** The computed color of the host's synthesized scrim veil (::after). */
function veilColor(page: Page): Promise<string> {
  return barHost(page).evaluate((el) => getComputedStyle(el, '::after').backgroundColor);
}

/** The backdrop's transparent resting color (both engines). */
const TRANSPARENT = 'rgba(0, 0, 0, 0)';

test.describe('mobile bottom action bar (phones)', () => {
  test.skip(
    ({ viewport }) => (viewport?.width ?? 0) >= 768,
    'the bar only renders below the 768px shell breakpoint',
  );
  // Import + the WebKit drawer/sheet choreography can exceed the default
  // budget; the batch-swap flow test raises the bar further (two sheet
  // round-trips, an apply + snackbar settle and a focus-recovery beat).
  test.describe.configure({ timeout: 96_000 });

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

  test('under an open drawer the bar stays docked and taps on it are no-ops', async ({ page }) => {
    await page.goto('/');
    await importLorebook(page, FATE_PATH);
    const tabsBefore = await page.locator('.entry-tabs .mat-mdc-tab').count();
    await expect(barNav(page)).toBeVisible();

    await barNav(page).getByRole('button', { name: 'Toggle history drawer' }).click();
    const history = page.locator('.history-sidenav');
    await expect(history).toBeInViewport();
    await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();

    // An over-drawer's scrim cannot cover the bar (it lives outside the
    // sidenav container), so the bar lowers itself to `backgrounded` instead
    // of unstamping: the row stays in flow, its content goes inert and the
    // scrim recipe the strip cannot inherit is synthesized as a veil.
    await expect(barNav(page)).toBeVisible();
    await expect(barNav(page)).toHaveAttribute('inert', '');
    await expect(barHost(page)).toHaveClass(/bar-backgrounded/);
    await expect.poll(veilColor.bind(null, page)).not.toBe(TRANSPARENT);

    // Tapping a bar item must not act while the strip is inert. A forced
    // click bypasses Playwright's hit-test actionability — the same press the
    // strip's pointer-events: none lets through — so this reads exactly like
    // a real user's tap on the veiled row: no editor tab may open and the
    // drawer must stay open (the item's handler toggles it, so half-inertness
    // would close it — both ways to fail are covered).
    await barNav(page).getByRole('button', { name: 'New entry' }).click({ force: true });
    await expect(page.locator('.entry-tabs .mat-mdc-tab')).toHaveCount(tabsBefore);
    await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();

    // Release the drawer with a backdrop tap (the 340px end-drawer leaves the
    // backdrop's left sliver free; a coordinate tap needs no focus semantics,
    // unlike the Escape path pinned by its own test below).
    await page.mouse.click(12, 400);
    await expect(history).not.toBeInViewport();
    await expect(barNav(page)).toBeVisible();
    await expect(barNav(page)).not.toHaveAttribute('inert', '');
    await expect(barHost(page)).not.toHaveClass(/bar-backgrounded/);
    await expect.poll(veilColor.bind(null, page)).toBe(TRANSPARENT);

    // Interactive again: the quick actions act like nothing was borrowed.
    await barNav(page).getByRole('button', { name: 'New entry' }).click();
    await expect(page.locator('.entry-tabs .mat-mdc-tab')).toHaveCount(tabsBefore + 1);
  });

  test('Escape closes the drawer from every open path without a focus workaround', async ({
    page,
  }) => {
    await page.goto('/');
    await importLorebook(page, FATE_PATH);
    await expect(barNav(page)).toBeVisible();

    await barNav(page).getByRole('button', { name: 'Toggle history drawer' }).click();
    const history = page.locator('.history-sidenav');
    await expect(history).toBeInViewport();
    await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();
    await expect(history).not.toHaveClass(/mat-drawer-animating/, { timeout: 10_000 });

    // The shell's phone pane-focus policy re-focuses the drawer pane when it
    // finishes opening — the bar's own content going inert released focus to
    // <body> mid-tap. The pane therefore already holds focus when the Escape
    // arrives: no `history.focus()` workaround, and the same pin holds for
    // drawer opened from the topbar hamburger or the keyboard.
    await page.keyboard.press('Escape');
    await expect(history).not.toBeInViewport();
    await expect(barNav(page)).toBeVisible();
    await expect(barHost(page)).not.toHaveClass(/bar-backgrounded/);
  });

  test('the About sheet covers the docked bar and the bar is interactive after close', async ({
    page,
  }) => {
    await page.goto('/');
    await importLorebook(page, FATE_PATH);
    const tabsBefore = await page.locator('.entry-tabs .mat-mdc-tab').count();
    await expect(barNav(page)).toBeVisible();

    // About via the More menu: on phones it opens as the About bottom sheet.
    await page.locator('[aria-label="More actions menu"]').click();
    await page.getByRole('menuitem', { name: 'About LoreStitch…' }).click();
    const pane = page.locator('.cdk-overlay-pane.app-about-sheet');
    await expect(pane).toBeVisible();

    // CDK overlays are full-viewport and cover/dim the strip themselves —
    // the bar keeps no bar-side state for dialogs: still mounted, still in
    // its `normal` shape (no inert, no veil class) under the sheet.
    await expect(barNav(page)).toBeVisible();
    await expect(barHost(page)).not.toHaveClass(/bar-backgrounded/);
    await expect(barNav(page)).not.toHaveAttribute('inert', '');

    await pane.getByRole('button', { name: 'Close about' }).click();
    await expect(pane).toBeHidden();
    // Interactive again after the sheet releases.
    await barNav(page).getByRole('button', { name: 'New entry' }).click();
    await expect(page.locator('.entry-tabs .mat-mdc-tab')).toHaveCount(tabsBefore + 1);
  });

  test('the batch swap moves the batch toolbar into the bar and recovers focus on clear', async ({
    page,
  }) => {
    await page.goto('/');
    await importLorebook(page, FATE_PATH);
    // Idle: project open, drawer closed — the five quick actions at rest.
    await expect(barNav(page)).toBeVisible();
    expect(await veilColor(page)).toBe(TRANSPARENT);

    // Open the entries drawer with nothing selected: the bar lowers to
    // `backgrounded` (veiled, inert — the no-op probe lives in the History
    // drawer test above; here only selection-driven state is asserted).
    await page.locator('[aria-label="Toggle entries panel"]').click();
    const entries = page.locator('.entries-sidenav');
    await expect(entries).toBeInViewport();
    await expect(entries).not.toHaveClass(/mat-drawer-animating/, { timeout: 10_000 });
    await expect(barNav(page)).toHaveAttribute('inert', '');
    await expect(barHost(page)).toHaveClass(/bar-backgrounded/);

    // Select two rows: the bar comes back to foreground swapped — the
    // transplanted toolbar is the ONLY batch toolbar on a phone (the header
    // toolbar is the docked-panel-width surface) and it fully replaces the
    // quick actions.
    const rows = page.locator('.entry-item');
    await rows.first().locator('.row-select').click();
    await rows.nth(1).locator('.row-select').click();
    await expect(page.getByRole('toolbar', { name: 'Batch actions' })).toContainText(
      '2 selected',
    );
    await expect(barBatchToolbar(page)).toHaveCount(1);
    await expect(barBatchToolbar(page)).toHaveAttribute('role', 'toolbar');
    await expect(barBatchToolbar(page)).toHaveAttribute('aria-label', 'Batch actions');
    await expect(page.locator('app-entry-list .batch-bar')).toHaveCount(0);
    await expect(barNav(page)).toHaveCount(0);
    await expect(page.locator('app-mobile-bottom-bar .bar-item')).toHaveCount(0);
    await expect(barHost(page)).toHaveClass(/bar-batch/);
    await expect(barHost(page)).not.toHaveClass(/bar-backgrounded/);
    await expect.poll(veilColor.bind(null, page)).toBe(TRANSPARENT);

    // Batch edit from the swap: the sheet opens above the strip; the swapped
    // toolbar stays mounted under it (`batch` deliberately survives a dialog
    // on top — the CDK overlay covers and dims the strip itself).
    await barBatchToolbar(page).getByRole('button', { name: 'Batch edit selection' }).click();
    const batchPane = page.locator('.cdk-overlay-pane.app-batch-sheet');
    await expect(batchPane).toBeVisible();
    await expect(barBatchToolbar(page)).toBeAttached();

    // Close without applying: the sheet goes, the selection and the swap stay.
    await page.keyboard.press('Escape');
    await expect(batchPane).toBeHidden();
    await expect(barBatchToolbar(page)).toBeAttached();
    await expect(barHost(page)).toHaveClass(/bar-batch/);

    // Applying disables the two selected entries: the pane closes itself, the
    // result collapses the selection and the bar lowers back to `backgrounded`
    // (the swap gives way — the strip's state is drawer + selection driven).
    await barBatchToolbar(page).getByRole('button', { name: 'Batch edit selection' }).click();
    await expect(batchPane).toBeVisible();
    await batchPane.getByRole('radio', { name: 'Disable' }).click();
    await batchPane.getByRole('button', { name: 'Apply to 2 entries' }).click();
    await expect(batchPane).toBeHidden();
    // The apply snackbar spans the viewport bottom edge for 3s; wait it out
    // before the next strip interaction.
    await page
      .locator('.mat-mdc-snack-bar-container')
      .first()
      .waitFor({ state: 'hidden', timeout: 15_000 });
    await expect(barBatchToolbar(page)).toHaveCount(0);
    await expect(barHost(page)).toHaveClass(/bar-backgrounded/);
    await expect(barNav(page)).toHaveCount(1);
    await expect(barNav(page)).toHaveAttribute('inert', '');
    await expect.poll(veilColor.bind(null, page)).not.toBe(TRANSPARENT);

    // The ✕ (clear selection): re-select, then clear. The tapped control
    // unmounts from the strip and the bar lowers back to backgrounded — the
    // shell's focus recovery must land focus INSIDE the drawer pane so its
    // own Escape handling stays alive right after the strip interaction.
    await rows.first().locator('.row-select').click();
    await rows.nth(1).locator('.row-select').click();
    await expect(page.getByRole('toolbar', { name: 'Batch actions' })).toContainText(
      '2 selected',
    );
    await barBatchToolbar(page).getByRole('button', { name: 'Clear selection' }).click();
    const paneHoldsFocus = await page.evaluate(
      () => (document.activeElement as HTMLElement | null)?.matches('.entries-sidenav') ?? false,
    );
    expect(
      paneHoldsFocus,
      'the entries pane must hold focus after the bar clears the selection',
    ).toBe(true);
    await expect(barBatchToolbar(page)).toHaveCount(0);
    await expect(barHost(page)).toHaveClass(/bar-backgrounded/);

    // Closing the drawer hands the strip back to its normal quick actions.
    await page.keyboard.press('Escape');
    await expect(entries).not.toBeInViewport();
    await expect(barHost(page)).not.toHaveClass(/bar-backgrounded/);
    await expect(page.locator('app-mobile-bottom-bar .bar-item')).toHaveCount(5);
    await expect(barNav(page)).toBeVisible();
  });

  // The bar items' 48px touch-target check lives in ui-responsiveness.spec.ts
  // ("rows, batch controls, accordion strip and bar items…"), which measures
  // the same five `.bar-item`s — and the swapped `.batch-bar button`s —
  // alongside the other mobile surfaces.
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

  test('with a selection the inline header batch toolbar stays in the drawer', async ({
    page,
  }) => {
    await page.goto('/');
    await importLorebook(page, FATE_PATH);
    await selectFirstTwoRows(page);

    // Task 06 deliberately keeps today's inline header toolbar at
    // docked-panel widths (no bar exists here; only phones swap the toolbar
    // into the strip). The shared helper's role/label contract resolves to
    // the drawer's toolbar the same way it does inside the swap on phones.
    const toolbar = page.locator('app-entry-list .batch-bar');
    await expect(toolbar).toBeVisible();
    await expect(toolbar).toContainText('2 selected');
    // …and the phone-only bar contributes nothing at this width.
    await expect(page.locator('app-mobile-bottom-bar .bar-item')).toHaveCount(0);
  });
});
