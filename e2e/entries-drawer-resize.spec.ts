import { expect, type Page, test } from '@playwright/test';
import { strict as assert } from 'node:assert';
import { createProject, FATE_PATH, importLorebook } from './helpers';

/**
 * Entries drawer width contracts (task 21, user-locked D2/D3).
 *
 * Docked band (tablet/desktop): the drawer is user-resizable inside the
 * app-enforced 320–480px clamp — a pointer drag tracks the gesture and
 * commits on release, the keyboard steps live and commits on keyup, a
 * double-click resets to the 320px default, and the committed width
 * persists across reloads through the `lorestitch.entries-drawer-width`
 * storage key. The plan's known risk point is CDK virtual-scroll recovery
 * under a live width change, so rows must stay rendered and fill the
 * viewport at every stop of the range.
 *
 * Mobile band: the drawer is a full-width overlay (a work surface, not a
 * peek) whose header carries its own close button — a full-width panel has
 * no scrim sliver left to tap — and the resize handle is removed from the
 * DOM entirely.
 */

test.describe('docked drawer resize (tablet/desktop band)', () => {
  // Band gate (delimiters/linter precedent): the resizable docked drawer is
  // a >= 768px contract — replaying it under the mobile projects would only
  // re-run the desktop layout with a phone UA.
  test.skip(
    () => test.info().project.name.startsWith('mobile-'),
    'docked-band leg runs on the desktop project only',
  );

  test.use({ viewport: { width: 1280, height: 800 } });

  /** Exact attribute selectors — "Close/Toggle entries panel" are neighbors. */
  const HANDLE = '[aria-label="Resize entries panel"]';

  /** The drawer's live inline width, e.g. "440px" (the App binding). */
  const inlineWidth = (page: Page) =>
    page.locator('.entries-sidenav').evaluate((el: HTMLElement) => el.style.width);

  /** The drawer's painted width — the user-visible fact, not just the style string. */
  async function paintedWidth(page: Page): Promise<number> {
    const box = await page.locator('.entries-sidenav').boundingBox();
    assert(box, 'entries drawer has no bounding box');
    return box.width;
  }

  /** Expects the painted width to sit within a pixel of the target. */
  async function expectPaintedWidth(page: Page, target: number): Promise<void> {
    const width = await paintedWidth(page);
    expect(Math.abs(width - target), `painted width ${width} ≈ ${target}`).toBeLessThanOrEqual(1);
  }

  // The key literal rides inside the page-side callback: page.evaluate
  // serializes the function into the browser, where spec-scope constants
  // do not exist.
  const storedWidth = (page: Page) =>
    page.evaluate(() => localStorage.getItem('lorestitch.entries-drawer-width'));

  /**
   * Drags the resize handle to client x `targetX` and releases: pointerdown
   * on the 6px strip, live moves (each updates the width), pointerup
   * commits. Pointer capture retargets the whole gesture onto the handle,
   * so the moves may leave the strip freely. The handle is re-read per
   * gesture — it rides the drawer's right edge, which prior drags moved.
   */
  async function dragHandleTo(page: Page, targetX: number): Promise<void> {
    const box = await page.locator(HANDLE).boundingBox();
    assert(box, 'resize handle has no bounding box');
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(targetX, y, { steps: 8 });
    await page.mouse.up();
  }

  /**
   * The virtual list must recover under a live width change: rendered rows
   * stay (>4 — the Fate fixture has 70), the first row is painted, the CDK
   * viewport refills after its ResizeObserver re-measure (the same fill
   * contract the mobile virtual-list test pins), and rows fit inside the
   * resized drawer. Polled, never slept: the re-measure is asynchronous.
   */
  async function expectRowsRecovered(page: Page): Promise<void> {
    await expect
      .poll(() => page.locator('app-entry-list .entry-item').count(), {
        timeout: 5_000,
        message: 'rows must stay rendered after the resize',
      })
      .toBeGreaterThan(4);
    await expect(page.locator('app-entry-list .entry-item').first()).toBeVisible();

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
        { timeout: 5_000, message: 'the virtual list must fill the resized viewport' },
      )
      .toBeLessThanOrEqual(8);

    const drawerBox = await page.locator('.entries-sidenav').boundingBox();
    assert(drawerBox, 'entries drawer has no bounding box');
    const rowBox = await page.locator('app-entry-list .entry-item').first().boundingBox();
    assert(rowBox, 'first row has no bounding box');
    expect(
      rowBox.x + rowBox.width,
      'the first row must paint inside the resized drawer',
    ).toBeLessThanOrEqual(drawerBox.x + drawerBox.width + 1);
  }

  test('mouse drag resizes the drawer and the painted width tracks the pointer', async ({
    page,
  }) => {
    await createProject(page, 'Drawer resize E2E');
    const handle = page.locator(HANDLE);
    const box = await handle.boundingBox();
    assert(box, 'resize handle has no bounding box');
    const y = box.y + box.height / 2;

    await page.mouse.move(box.x + box.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(420, y, { steps: 8 });
    // Mid-gesture the width is already live: the drawer is docked at x=0,
    // so the binding equals the pointer's clientX at this stop.
    await expect
      .poll(() => inlineWidth(page), {
        timeout: 5_000,
        message: 'the inline width binding must track the drag',
      })
      .toBe('420px');
    await expectPaintedWidth(page, 420);

    // A second stop proves the width TRACKS the pointer rather than
    // jumping once.
    await page.mouse.move(460, y, { steps: 8 });
    await expect
      .poll(() => inlineWidth(page), {
        timeout: 5_000,
        message: 'the inline width must follow the pointer to the next stop',
      })
      .toBe('460px');

    // Release commits: the storage write lands on pointerup, and the
    // handle's a11y value syncs with the committed width.
    await page.mouse.up();
    await expect
      .poll(() => storedWidth(page), { timeout: 5_000, message: 'the drag must commit' })
      .toBe('460');
    await expectPaintedWidth(page, 460);
    await expect(handle).toHaveAttribute('aria-valuenow', '460');
    await expect(handle).toHaveAttribute('aria-valuemin', '320');
    await expect(handle).toHaveAttribute('aria-valuemax', '480');
  });

  test('drag clamps at the 320 and 480 bounds', async ({ page }) => {
    await createProject(page, 'Drawer resize E2E');

    // Far right pins at the 480px ceiling — painted, not just the style
    // string (the CSS max-width is belt-and-braces behind the binding).
    await dragHandleTo(page, 1200);
    await expect(page.locator(HANDLE)).toHaveAttribute('aria-valuenow', '480');
    await expectPaintedWidth(page, 480);
    await expect
      .poll(() => storedWidth(page), { timeout: 5_000, message: 'the clamped drag commits' })
      .toBe('480');

    // Far left pins at the 320px floor — the batch-bar capacity the drawer
    // is designed around.
    await dragHandleTo(page, 12);
    await expect(page.locator(HANDLE)).toHaveAttribute('aria-valuenow', '320');
    await expectPaintedWidth(page, 320);
    await expect
      .poll(() => storedWidth(page), { timeout: 5_000, message: 'the clamped drag commits' })
      .toBe('320');
  });

  test('a committed resize persists across a reload', async ({ page }) => {
    await createProject(page, 'Drawer resize E2E');
    await dragHandleTo(page, 440);
    await expect
      .poll(() => storedWidth(page), { timeout: 5_000, message: 'the drag must commit' })
      .toBe('440');

    await page.reload();
    await expect(page.locator('.entries-sidenav')).toBeAttached();
    // The startup read restores the committed width — a shell preference
    // that outlives the session.
    await expect
      .poll(() => inlineWidth(page), {
        timeout: 5_000,
        message: 'the persisted width must restore at startup',
      })
      .toBe('440px');
    await expectPaintedWidth(page, 440);
  });

  test('keyboard resizes: arrows step live, End/Home jump, the write lands on keyup', async ({
    page,
  }) => {
    await createProject(page, 'Drawer resize E2E');
    const handle = page.locator(HANDLE);
    await handle.focus();

    // Keydown applies the ±8px step to the DOM immediately...
    await page.keyboard.down('ArrowRight');
    await expect
      .poll(() => inlineWidth(page), {
        timeout: 5_000,
        message: 'the arrow key must step the width live',
      })
      .toBe('328px');
    // ...but the storage write waits for keyup (the keyup-commit contract).
    expect(await storedWidth(page), 'no write before keyup').toBeNull();
    await page.keyboard.up('ArrowRight');
    await expect
      .poll(() => storedWidth(page), { timeout: 5_000, message: 'keyup commits the step' })
      .toBe('328');

    // The mirrored step walks back to the floor: 328 - 8 = 320.
    await handle.press('ArrowLeft');
    await expect
      .poll(() => storedWidth(page), { timeout: 5_000, message: 'keyup commits the step' })
      .toBe('320');
    await expectPaintedWidth(page, 320);

    // End/Home jump straight to the clamp bounds and commit.
    await handle.press('End');
    await expect
      .poll(() => storedWidth(page), { timeout: 5_000, message: 'End commits 480' })
      .toBe('480');
    await expectPaintedWidth(page, 480);
    await handle.press('Home');
    await expect
      .poll(() => storedWidth(page), { timeout: 5_000, message: 'Home commits 320' })
      .toBe('320');
    await expectPaintedWidth(page, 320);
  });

  test('double-click resets the drawer to the 320px default', async ({ page }) => {
    await createProject(page, 'Drawer resize E2E');
    const handle = page.locator(HANDLE);
    await handle.press('End');
    await expect
      .poll(() => storedWidth(page), { timeout: 5_000, message: 'End commits 480' })
      .toBe('480');

    await handle.dblclick();
    await expect
      .poll(() => inlineWidth(page), {
        timeout: 5_000,
        message: 'the double-click must reset to the default',
      })
      .toBe('320px');
    await expectPaintedWidth(page, 320);
    await expect
      .poll(() => storedWidth(page), { timeout: 5_000, message: 'the reset commits' })
      .toBe('320');
  });

  test('rows keep rendering across the resize range (CDK viewport recovery)', async ({
    page,
  }) => {
    // A real multi-page list: the Fate fixture's 70 entries exercise the
    // virtual scroller's rendered range, not a three-row toy list.
    await page.goto('/');
    await importLorebook(page, FATE_PATH);

    // Max → mid → min: rows must recover at every stop of the range, not
    // only at the extremes.
    await dragHandleTo(page, 480);
    await expectRowsRecovered(page);
    await dragHandleTo(page, 400);
    await expectRowsRecovered(page);
    await dragHandleTo(page, 320);
    await expectRowsRecovered(page);
  });
});

test.describe('mobile full-width overlay drawer (phone band)', () => {
  // Phone-pinned gate (delimiters/linter precedent): the full-width overlay
  // and its close button only exist under the shell's 768px breakpoint, so
  // the desktop project would only replay the flow against the docked
  // drawer. Both mobile projects keep it (WebKit parity).
  test.skip(
    () => test.info().project.name === 'desktop-chrome',
    'phone-pinned drawer contract runs on the mobile projects only',
  );

  test('the opened drawer paints full width and carries no resize handle', async ({ page }) => {
    await createProject(page, 'Drawer resize E2E');
    const drawer = page.locator('.entries-sidenav');
    await page.locator('[aria-label="Toggle entries panel"]').click();
    await expect(drawer).toBeInViewport();

    // D2: the entries drawer is a work surface — it opens full-width. The
    // target is computed from the live layout viewport, never a pinned
    // device figure (the two phone projects differ: Pixel 7 vs iPhone 14).
    // Polled over the slide-in: intermediate frames can mis-measure.
    const viewportWidth = page.viewportSize()?.width;
    assert(viewportWidth, 'page has no viewport size');
    await expect
      .poll(
        async () => {
          const box = await drawer.boundingBox();
          return box ? Math.abs(box.width - viewportWidth) : Number.POSITIVE_INFINITY;
        },
        { timeout: 5_000, message: 'the drawer must paint full width' },
      )
      .toBeLessThanOrEqual(1);

    // The resize handle belongs to the docked band only — removed from the
    // DOM at this band (responsive-shape contract), never display:none.
    await expect(page.locator('[aria-label="Resize entries panel"]')).toHaveCount(0);
  });

  test('the header close button releases the drawer', async ({ page }) => {
    await createProject(page, 'Drawer resize E2E');
    const drawer = page.locator('.entries-sidenav');
    await page.locator('[aria-label="Toggle entries panel"]').click();
    await expect(drawer).toBeInViewport();

    // The full-width overlay leaves no scrim sliver to tap, so the pane
    // carries its own close affordance in the header's title row. Assert
    // the accessible name, never tooltip text — tooltips also fire on
    // long-press in the touch projects.
    const close = drawer
      .locator('.title-row')
      .getByRole('button', { name: 'Close entries panel', exact: true });
    await expect(close).toBeVisible();
    await expect(close).toHaveAttribute('aria-label', 'Close entries panel');

    await close.click();
    await expect(drawer).not.toBeInViewport();
    // Settle the slide-out before the test ends: a later gesture started
    // mid-transition races the stale `transitionend` (drawer choreography
    // precedent).
    await expect(drawer).not.toHaveClass(/mat-drawer-animating/, { timeout: 10_000 });
  });
});
