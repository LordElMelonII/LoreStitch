import { expect, type Locator, type Page, test } from '@playwright/test';
import { FATE_PATH, importLorebook } from './helpers';

/**
 * Range multi-selection on the entries drawer list (task 20 D1–D3):
 * shift+click and long-press, BOTH on the row checkbox only. The desktop
 * describe pins the shift+click semantics as a user sees them — range
 * select/deselect over the inclusive filtered slice, the anchor staying put
 * across gestures, the row body keeping its plain open behavior, and ranges
 * computed over the filtered view — the mobile describe pins the touch
 * long-press, its no-anchor degradation, and the swallowed release click.
 *
 * The pure slice math and the anchor/timer machinery are exhaustively
 * covered by the unit suites (`entry-list.model.spec.ts`,
 * `entry-list.spec.ts`); these specs pin the WIRING end-to-end: real
 * trusted clicks carrying shiftKey, real engine touch input where the
 * engine allows it, and the browser-synthesized release click after a
 * fired long-press.
 */

/**
 * Hold past the component's LONG_PRESS_MS (500) so the long-press timer
 * fires with margin for timer jitter.
 */
const LONG_PRESS_HOLD_MS = 650;

/**
 * The release click a browser synthesizes after a fired long-press lands
 * within milliseconds of the touch end; settling this window pins the
 * ABSENCE of a second application (the nested-menu-touch FLASH_WINDOW_MS
 * precedent — a fixed window over which a state must not change).
 */
const RELEASE_CLICK_WINDOW_MS = 300;

/**
 * Ground truth against the bundled Fate/Stay Night fixture (recompute when
 * the fixture changes — the search-responsiveness.spec precedent): the
 * query matches exactly 6 entries' sidebar haystacks.
 */
const FILTER_QUERY = 'Excalibur';
const FILTERED_COUNT = '6';

/** The virtual-scroll rows currently rendered in the entries list. */
function rows(page: Page): Locator {
  return page.locator('.entry-item');
}

/** A row's selection checkbox — the only range-gesture surface (D5 fence). */
function rowCheckbox(page: Page, index: number): Locator {
  return rows(page).nth(index).locator('.row-select');
}

/**
 * The batch toolbar's tri-state select-all control, whose accessible name
 * carries the live selection count on BOTH form factors (the in-drawer
 * header toolbar on tablet/desktop, the docked bottom bar's batch strip on
 * phones — the `selectFirstTwoRows` DOM contract).
 */
function selectionCountCheckbox(page: Page, count: number): Locator {
  return page
    .getByRole('toolbar', { name: 'Batch actions' })
    .getByRole('checkbox', { name: `Select all shown entries (${count} selected)` });
}

/**
 * Reveals the entries drawer on phones (off-canvas below the shell's 768px
 * breakpoint — the `selectFirstTwoRows`/`openEntryRow` choreography).
 */
async function openEntriesDrawer(page: Page): Promise<void> {
  await page.locator('[aria-label="Toggle entries panel"]').click();
  await expect(page.getByRole('heading', { name: 'Entries' })).toBeVisible();
}

/**
 * Long-press synthesis on mobile-chrome: the REAL input pipeline through
 * the CDP Input domain — touchStart on the checkbox, a hold past
 * LONG_PRESS_MS, then touchEnd. Chromium derives the touch sequence's
 * pointer events (pointerType 'touch', which arms the component's timer)
 * and synthesizes the release click afterwards (which the component's
 * capture interceptor must swallow), so this route is engine-faithful on
 * both legs of the gesture.
 */
async function cdpLongPress(page: Page, target: Locator): Promise<void> {
  const box = await target.boundingBox();
  if (!box) {
    throw new Error('checkbox not rendered for the CDP touch');
  }
  const session = await page.context().newCDPSession(page);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y }],
  });
  await page.waitForTimeout(LONG_PRESS_HOLD_MS);
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await session.detach();
}

/**
 * Long-press synthesis on mobile-safari (WebKit exposes no CDP): cancelable
 * DOM PointerEvents with pointerType 'touch' dispatched straight onto the
 * checkbox host — the component handlers read only pointerType/clientX/Y,
 * so the synthetic sequence drives the exact same code path (pointerdown
 * arms the timer, the hold fires it, pointerup releases). A browser never
 * synthesizes the release click for a dispatched pointerup, so the tests
 * fire a bare release click themselves (see `fireBareReleaseClick`).
 */
async function syntheticPointerLongPress(page: Page, target: Locator): Promise<void> {
  await target.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    el.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        pointerType: 'touch',
        pointerId: 1,
        isPrimary: true,
        button: 0,
        buttons: 1,
        clientX: rect.x + rect.width / 2,
        clientY: rect.y + rect.height / 2,
      }),
    );
  });
  await page.waitForTimeout(LONG_PRESS_HOLD_MS);
  await target.evaluate((el) => {
    el.dispatchEvent(
      new PointerEvent('pointerup', {
        bubbles: true,
        cancelable: true,
        pointerType: 'touch',
        pointerId: 1,
        isPrimary: true,
        button: 0,
        buttons: 0,
      }),
    );
  });
}

/** The engine-appropriate long-press route for the running project. */
function longPress(page: Page, target: Locator, project: string): Promise<void> {
  return project === 'mobile-safari'
    ? syntheticPointerLongPress(page, target)
    : cdpLongPress(page, target);
}

/**
 * Simulates the release click after a fired long-press on WebKit: a bare
 * click (`el.click()`'s synthetic click activation — no preceding pointer
 * events, exactly the shape of a real touch-release click, which is what
 * keeps the component's swallow flag armed) on the checkbox's inner input.
 * The capture interceptor must preventDefault it; a broken swallow would
 * let the native activation toggle the box again and drop the count.
 */
async function fireBareReleaseClick(page: Page, index: number): Promise<void> {
  await rows(page)
    .nth(index)
    .locator('.row-select input')
    .evaluate((el) => (el as HTMLInputElement).click());
}

test.describe('shift+click range selection on desktop (mouse, no touch)', () => {
  test.use({ hasTouch: false, viewport: { width: 1280, height: 800 } });
  // Project gate (nested-menu-touch precedent): pins a mouse-driven desktop
  // viewport, so the mobile projects would only replay it under a phone UA.
  test.skip(
    () => test.info().project.name.startsWith('mobile-'),
    'desktop shift+click leg runs on the desktop project only',
  );

  test('shift+click on a farther checkbox selects the inclusive range', async ({ page }) => {
    await page.goto('/');
    await importLorebook(page, FATE_PATH);

    // Plain click = the native path: single select, sets the anchor.
    await rowCheckbox(page, 0).click();
    await expect(selectionCountCheckbox(page, 1)).toBeVisible();

    // Trusted click carrying shiftKey: the range covers the inclusive
    // filtered slice between anchor and gesture row.
    await rowCheckbox(page, 2).click({ modifiers: ['Shift'] });
    await expect(selectionCountCheckbox(page, 3)).toBeVisible();
    for (const index of [0, 1, 2]) {
      await expect(rows(page).nth(index)).toHaveClass(/selected/);
    }
    // Inclusive of the gesture row, exclusive beyond it.
    await expect(rows(page).nth(3)).not.toHaveClass(/selected/);
  });

  test('shift+click on a selected gesture row unselects the range back', async ({ page }) => {
    await page.goto('/');
    await importLorebook(page, FATE_PATH);

    await rowCheckbox(page, 0).click();
    await rowCheckbox(page, 2).click({ modifiers: ['Shift'] });
    await expect(selectionCountCheckbox(page, 3)).toBeVisible();

    // The gesture row is selected, so the range takes its new (unselected)
    // state — the anchor did not move, so the whole slice clears.
    await rowCheckbox(page, 2).click({ modifiers: ['Shift'] });
    await expect(page.getByRole('toolbar', { name: 'Batch actions' })).toHaveCount(0);
    for (const index of [0, 1, 2]) {
      await expect(rows(page).nth(index)).not.toHaveClass(/selected/);
    }
  });

  test('the anchor stays put across range gestures (A, shift-C, shift-E covers A..E)', async ({
    page,
  }) => {
    await page.goto('/');
    await importLorebook(page, FATE_PATH);

    await rowCheckbox(page, 0).click();
    await rowCheckbox(page, 2).click({ modifiers: ['Shift'] });
    await expect(selectionCountCheckbox(page, 3)).toBeVisible();

    // A second range gesture still ranges from A: the anchor does not move.
    await rowCheckbox(page, 4).click({ modifiers: ['Shift'] });
    await expect(selectionCountCheckbox(page, 5)).toBeVisible();
    for (const index of [0, 1, 2, 3, 4]) {
      await expect(rows(page).nth(index)).toHaveClass(/selected/);
    }

    // Discriminator the headline count cannot express: with the anchor
    // still A, deselecting through C clears only A..C (D and E survive) —
    // an anchor that had drifted to E would clear C..E instead.
    await rowCheckbox(page, 2).click({ modifiers: ['Shift'] });
    await expect(selectionCountCheckbox(page, 2)).toBeVisible();
    await expect(rows(page).nth(3)).toHaveClass(/selected/);
    await expect(rows(page).nth(4)).toHaveClass(/selected/);
    await expect(rows(page).nth(0)).not.toHaveClass(/selected/);
  });

  test('shift+click on the row body still opens the entry editor', async ({ page }) => {
    await page.goto('/');
    await importLorebook(page, FATE_PATH);

    // The range gestures live on the checkbox only (D5 scope fence): the
    // row body keeps its plain open behavior untouched.
    await rows(page).nth(0).locator('.item-main').click({ modifiers: ['Shift'] });
    await expect(page.locator('app-entry-editor .entry-tabs')).toBeVisible();
    // And the shift-click selected nothing: no batch toolbar appeared.
    await expect(page.getByRole('toolbar', { name: 'Batch actions' })).toHaveCount(0);
  });

  test('a range gesture covers only the filtered view', async ({ page }) => {
    await page.goto('/');
    await importLorebook(page, FATE_PATH);

    // Type the query and let the settled list absorb the SEARCH_DEBOUNCE_MS
    // window (the auto-retrying badge assertion is the round-trip spec's
    // EDIT_COMMIT_FLUSH settle precedent — never a pinned timer).
    const badge = page.locator('.entries-sidenav .title-row .count');
    const filter = page.getByLabel('Filter entries', { exact: true });
    await filter.fill(FILTER_QUERY);
    await expect(badge).toHaveText(FILTERED_COUNT);

    await rowCheckbox(page, 0).click();
    await rowCheckbox(page, 2).click({ modifiers: ['Shift'] });
    await expect(selectionCountCheckbox(page, 3)).toBeVisible();

    // The anchor (filtered row 0) still rules the second gesture: ranging
    // to the LAST filtered row covers exactly the six visible entries — a
    // range computed over the unfiltered book would have swept hidden rows
    // into a far larger count.
    await rowCheckbox(page, 5).click({ modifiers: ['Shift'] });
    await expect(selectionCountCheckbox(page, 6)).toBeVisible();
  });
});

test.describe('long-press range selection on touch (phone viewport)', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  // Cold WebKit boot + import + two 650ms holds exceed the default 30s
  // budget when the suite runs at once — the delimiters/round-trip mobile
  // allowance (nested-menu-touch precedent).
  test.describe.configure({ timeout: 75_000 });
  // Project gate: a phone + touch leg by design — desktop-chrome has no
  // touch pipeline and never arms the long-press (mouse never arms, D3).
  test.skip(
    () => test.info().project.name === 'desktop-chrome',
    'touch long-press leg runs on the mobile projects only',
  );

  test('long-press from a tapped anchor range-selects and the release click does not double-apply', async ({
    page,
  }) => {
    await page.goto('/');
    await importLorebook(page, FATE_PATH);
    await openEntriesDrawer(page);

    // Tap = a release before the threshold: the native path owns it and
    // sets the anchor.
    await rowCheckbox(page, 0).tap();
    await expect(selectionCountCheckbox(page, 1)).toBeVisible();

    await longPress(page, rowCheckbox(page, 2), test.info().project.name);
    await expect(selectionCountCheckbox(page, 3)).toBeVisible();
    for (const index of [0, 1, 2]) {
      await expect(rows(page).nth(index)).toHaveClass(/selected/);
    }

    // The release click the engine synthesizes after the fired long-press
    // is swallowed exactly once (A and C stay selected — a double
    // application would toggle the gesture row back off). Chromium
    // synthesizes it from the CDP touch sequence itself; WebKit never
    // synthesizes a click for a dispatched pointerup, so the spec fires
    // the bare release click on the inner input.
    if (test.info().project.name === 'mobile-safari') {
      await fireBareReleaseClick(page, 2);
    }
    await page.waitForTimeout(RELEASE_CLICK_WINDOW_MS);
    await expect(selectionCountCheckbox(page, 3)).toBeVisible();
    for (const index of [0, 1, 2]) {
      await expect(rows(page).nth(index)).toHaveClass(/selected/);
    }
  });

  test('a long-press with no anchor degrades to a single toggle that still sets the anchor', async ({
    page,
  }) => {
    await page.goto('/');
    await importLorebook(page, FATE_PATH);
    await openEntriesDrawer(page);

    // No prior selection, no anchor: the gesture degrades to a plain single
    // toggle of the long-pressed row.
    await longPress(page, rowCheckbox(page, 1), test.info().project.name);
    await expect(selectionCountCheckbox(page, 1)).toBeVisible();
    await expect(rows(page).nth(1)).toHaveClass(/selected/);
    await expect(rows(page).nth(0)).not.toHaveClass(/selected/);
    await expect(rows(page).nth(2)).not.toHaveClass(/selected/);

    // Degradation still moves the anchor onto the gesture row (D1): the
    // next long-press ranges FROM it.
    await longPress(page, rowCheckbox(page, 3), test.info().project.name);
    await expect(selectionCountCheckbox(page, 3)).toBeVisible();
    for (const index of [1, 2, 3]) {
      await expect(rows(page).nth(index)).toHaveClass(/selected/);
    }

    if (test.info().project.name === 'mobile-safari') {
      await fireBareReleaseClick(page, 3);
    }
    await page.waitForTimeout(RELEASE_CLICK_WINDOW_MS);
    await expect(selectionCountCheckbox(page, 3)).toBeVisible();
  });
});
