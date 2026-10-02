import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  activeEditorPane,
  entryRowTitle,
  expectSnackbar,
  FIRST_ROW_TITLE,
  focusBody,
  focusedTarget,
  FATE_PATH,
  importLorebook,
} from './helpers';

/**
 * Keyboard navigation suite (task 10 §3.8 row "E2E keyboard-navigation"):
 * the skip link, the roving entry list, selection chords, and the Escape
 * defaults — every route taken WITHOUT the pointer wherever the pin is a
 * keyboard fact.
 *
 * The pointer-free route into the list rides a Chromium fact the P3 sweep
 * proved: sequential focus resumes from the last pointer position, so a
 * fresh reload restarts it at the document top (capture.mjs state 04
 * recipe). From the skip link the suite walks BACKWARDS through the entries
 * drawer — deterministic, because the drawer's DOM is stable: resize handle
 * ← rendered rows' inner controls ← the one row-level stop (the active row,
 * tabindex 0) ← the filter. Walking forward from the active row then proves
 * the exit: the row's own controls, then the NEXT rendered rows' controls,
 * and never a second row-level stop before the resize handle.
 */

test.describe.configure({ timeout: 75_000 });

/** The virtual-scroll rows currently rendered in the entries list. */
function rows(page: Page): Locator {
  return page.locator('.entry-item');
}

/** The destructive-action confirm pane: centered dialog on tablet/desktop. */
function confirmPane(page: Page): Locator {
  return page.locator('.cdk-overlay-pane.app-compact-fullscreen-dialog');
}

/** The shortcuts help pane: centered dialog on tablet/desktop. */
function helpPane(page: Page): Locator {
  return page.locator('.cdk-overlay-pane.app-shortcuts-dialog');
}

/** Shift+Tab walk cap: ~3 stops per rendered row plus chrome, with margin. */
const WALK_CAP = 60;

/**
 * Pointer-free route from a fresh load to the ACTIVE entry row, entirely on
 * the keyboard: reload resets sequential focus to the document top, Tab
 * lands on the skip link, Enter jumps to the main region, and Shift+Tab
 * walks backwards through the drawer until the quick-filter is reached —
 * counting exactly one row-level stop (the active row) on the way. One
 * forward Tab from the filter then lands on that row.
 *
 * Returns the number of row-level stops seen on the backward walk.
 */
async function keyboardToActiveRow(page: Page): Promise<number> {
  await page.reload();
  await page.locator('[aria-label="More actions menu"]').waitFor({ state: 'visible' });
  await rows(page).first().waitFor({ state: 'visible' });

  await page.keyboard.press('Tab');
  await expect(page.locator('.skip-link')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#editor-content')).toBeFocused();

  let rowStops = 0;
  for (let i = 0; i < WALK_CAP; i++) {
    await page.keyboard.press('Shift+Tab');
    const info = await focusedTarget(page);
    if (info.isFilter) {
      break;
    }
    if (info.isRow) {
      rowStops += 1;
    }
  }
  if (!(await focusedTarget(page)).isFilter) {
    throw new Error(`Shift+Tab never reached the quick-filter within ${WALK_CAP} stops`);
  }
  await page.keyboard.press('Tab'); // the list's one row-level stop
  const landed = await focusedTarget(page);
  if (!landed.isRow || !landed.isCurrent) {
    throw new Error('Tab from the filter did not land on the active row');
  }
  return rowStops;
}

test.describe('skip link (desktop)', () => {
  test.skip(
    ({ viewport }) => (viewport?.width ?? 0) < 768,
    'the skip-link pins run on the desktop project; phones boot with drawers closed',
  );

  test('first Tab from a pointer-free load lands on the skip link; Enter jumps to the editor region', async ({
    page,
  }) => {
    await page.goto('/');
    await importLorebook(page, FATE_PATH);

    // Chromium resumes sequential focus from the last pointer position — the
    // import's clicks would corrupt the pin. A fresh reload restarts it at
    // the document top (capture.mjs state 04 recipe, probe-verified P3).
    await page.reload();
    await page.locator('[aria-label="More actions menu"]').waitFor({ state: 'visible' });
    await rows(page).first().waitFor({ state: 'visible' });

    await page.keyboard.press('Tab');
    const skipLink = page.locator('.skip-link');
    await expect(skipLink).toBeFocused();
    await expect(skipLink).toBeVisible(); // hidden until focused

    await page.keyboard.press('Enter');
    await expect(page.locator('#editor-content')).toBeFocused();
  });
});

test.describe('roving entry list (desktop)', () => {
  test.skip(
    ({ viewport }) => (viewport?.width ?? 0) < 768,
    'the roving-list pins run on the desktop project',
  );

  test('the list stops exactly once on Tab — the active row — and Tab exits past its inner controls', async ({
    page,
  }) => {
    await page.goto('/');
    await importLorebook(page, FATE_PATH);

    // Backward walk: through every rendered row's inner controls, exactly ONE
    // row-level stop (the active row's tabindex 0; every other row is -1).
    const rowStops = await keyboardToActiveRow(page);
    expect(rowStops).toBe(1);

    // The static roving contract over every rendered row: exactly one
    // tabbable row, and it is the one carrying aria-current.
    const rendered = await rows(page).evaluateAll((els) =>
      els.map((el) => ({
        tabindex: el.getAttribute('tabindex'),
        current: el.getAttribute('aria-current'),
      })),
    );
    expect(rendered.length).toBeGreaterThan(1);
    expect(rendered.filter((r) => r.tabindex === '0')).toHaveLength(1);
    expect(rendered.every((r) => (r.current === 'true') === (r.tabindex === '0'))).toBe(true);

    // Forward exit from the active row: every stop is an in-row control (the
    // row's own checkbox/duplicate/delete and the following rendered rows')
    // — never another row-level stop. The walk is bounded BY DESIGN: focusing
    // controls scrolls the virtual viewport, which renders MORE rows ahead,
    // so a walk to the resize handle would chase it through all 70 entries
    // (probe-verified P5, __screenshots__/10/probe-tab-walk.mjs). Fifteen
    // stops cover five rows' worth of controls — plenty to prove the row
    // divs at tabindex -1 never take a stop.
    for (let i = 0; i < 15; i++) {
      await page.keyboard.press('Tab');
      const info = await focusedTarget(page);
      expect(info.isRow, `forward stop ${i + 1} must not be a row-level stop`).toBe(false);
      expect(info.isResizeHandle, `forward stop ${i + 1} must still be inside the list`).toBe(
        false,
      );
    }
  });

  test('arrows and J/K move roving focus through a list longer than the rendered window', async ({
    page,
  }) => {
    await page.goto('/');
    await importLorebook(page, FATE_PATH);

    await keyboardToActiveRow(page); // focus on the active row (list scope)
    const startId = (await focusedTarget(page)).entryId;
    const startFirstRendered = await rows(page).first().getAttribute('data-entry-id');

    // The bundled fixture carries 70 entries; the drawer renders about a
    // dozen. Step past the rendered window, asserting the focused row after
    // EVERY press — the nav defers scroll-then-focus, so machine-speed
    // presses must pace on the settled focus (zoneless e2e pacing rule).
    let prevId = startId;
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press(i % 5 === 4 ? 'j' : 'ArrowDown');
      await expect
        .poll(async () => {
          const info = await focusedTarget(page);
          return info.isRow && info.isCurrent && info.entryId !== prevId;
        })
        .toBe(true);
      prevId = (await focusedTarget(page)).entryId;
    }
    expect(prevId).not.toBeNull();

    // One step back up with each of the two previous-entry keys still lands.
    for (const key of ['k', 'ArrowUp']) {
      await page.keyboard.press(key);
      await expect
        .poll(async () => {
          const info = await focusedTarget(page);
          return info.isRow && info.isCurrent && info.entryId !== prevId;
        })
        .toBe(true);
      prevId = (await focusedTarget(page)).entryId;
    }

    // The rendered window moved with the focus: the scroller scrolled and the
    // first rendered row is no longer the one we started on.
    const scrollTop = await page.evaluate(() => {
      const viewport = document.querySelector('.list-viewport');
      return viewport ? viewport.scrollTop : -1;
    });
    expect(scrollTop).toBeGreaterThan(0);
    expect(await rows(page).first().getAttribute('data-entry-id')).not.toBe(startFirstRendered);
  });
});

test.describe('keyboard selection (desktop)', () => {
  test.skip(
    ({ viewport }) => (viewport?.width ?? 0) < 768,
    'the selection-chord pins run on the desktop project',
  );

  test('Ctrl+Space toggles the focused row and Shift+ArrowDown extends a range a batch action applies to', async ({
    page,
  }) => {
    await page.goto('/');
    await importLorebook(page, FATE_PATH);

    await keyboardToActiveRow(page); // focus on the active row (row 0)

    await page.keyboard.press('Control+Space');
    await expect(
      page.getByRole('checkbox', { name: 'Select all shown entries (1 selected)' }),
    ).toBeVisible();

    await page.keyboard.press('Shift+ArrowDown');
    await expect(
      page.getByRole('checkbox', { name: 'Select all shown entries (2 selected)' }),
    ).toBeVisible();
    // The extension moves roving focus to the reached row (still a row-level
    // stop) while the ACTIVE entry does not follow.
    expect(await focusedTarget(page)).toMatchObject({ isRow: true, isCurrent: false });
    await expect(page.locator('.entry-item.selected')).toHaveCount(2);

    // A batch action applies to the keyboard-selected range.
    await page.locator('[aria-label="More batch actions"]').click();
    await page.getByRole('menuitem', { name: 'Disable selected' }).click();
    await expectSnackbar(page, 'Disabled 2 entries.');
    await expect(page.locator('.entry-item.selected.disabled-entry')).toHaveCount(2);
  });

  test('Shift+ArrowUp after extending down shrinks the selection one row per press', async ({
    page,
  }) => {
    await page.goto('/');
    await importLorebook(page, FATE_PATH);

    await keyboardToActiveRow(page); // focus on the active row (row 0)

    await page.keyboard.press('Control+Space');
    await expect(
      page.getByRole('checkbox', { name: 'Select all shown entries (1 selected)' }),
    ).toBeVisible();

    // Extend down three (pacing: assert the settled count before every next
    // press — machine-speed repeats outrun the zoneless render flush).
    for (const count of [2, 3, 4]) {
      await page.keyboard.press('Shift+ArrowDown');
      await expect(
        page.getByRole('checkbox', { name: `Select all shown entries (${count} selected)` }),
      ).toBeVisible();
    }

    // Stepping back up is a continuing gesture: each press deselects exactly
    // ONE row — it must never collapse the whole range at once.
    await page.keyboard.press('Shift+ArrowUp');
    await expect(
      page.getByRole('checkbox', { name: 'Select all shown entries (3 selected)' }),
    ).toBeVisible();
    await page.keyboard.press('Shift+ArrowUp');
    await expect(
      page.getByRole('checkbox', { name: 'Select all shown entries (2 selected)' }),
    ).toBeVisible();
  });

  test('Space on a row checkbox toggles selection without opening the editor', async ({
    page,
  }) => {
    await page.goto('/');
    await importLorebook(page, FATE_PATH);
    const nameInput = activeEditorPane(page).getByLabel('Entry name');
    const activeTitle = await nameInput.inputValue();
    const batchBar = page.getByRole('toolbar', { name: 'Batch actions' });

    // Focus a NON-active row's checkbox: the click lands on the input (the
    // checkbox's stopPropagation keeps the editor closed), which is exactly
    // where the pre-task bubbling bug bit — Space on the checkbox also
    // opened the row's editor.
    await rows(page).nth(1).locator('.row-select').click();
    await expect(batchBar).toBeVisible();
    await expect(
      page.getByRole('checkbox', { name: 'Select all shown entries (1 selected)' }),
    ).toBeVisible();

    // Space toggles the checkbox natively; the row's own (keydown.space)
    // handler must ignore the bubbled keydown, so the editor keeps showing
    // the import-time entry throughout. At 0 selected the batch toolbar
    // unmounts entirely — its absence IS the zero pin.
    await page.keyboard.press('Space');
    await expect(batchBar).toHaveCount(0);
    await expect(nameInput).toHaveValue(activeTitle);

    await page.keyboard.press('Space');
    await expect(batchBar).toBeVisible();
    await expect(
      page.getByRole('checkbox', { name: 'Select all shown entries (1 selected)' }),
    ).toBeVisible();
    await expect(nameInput).toHaveValue(activeTitle);
  });

  test('Enter on the row itself opens it — reached by extending selection down without opening', async ({
    page,
  }) => {
    await page.goto('/');
    await importLorebook(page, FATE_PATH);
    const nameInput = activeEditorPane(page).getByLabel('Entry name');
    const activeTitle = await nameInput.inputValue();
    const secondTitle = await entryRowTitle(page, 1);

    await keyboardToActiveRow(page); // focus on the active row (row 0)

    // Shift+ArrowDown moves roving focus to row 1 WITHOUT opening it — the
    // editor must still show the import-time entry.
    await page.keyboard.press('Shift+ArrowDown');
    expect(await focusedTarget(page)).toMatchObject({ isRow: true, isCurrent: false });
    await expect(nameInput).toHaveValue(activeTitle);

    // Enter on the focused row opens that entry in the editor.
    await page.keyboard.press('Enter');
    await expect(nameInput).not.toHaveValue(activeTitle);
    await expect(nameInput).toHaveValue(secondTitle);
  });
});

test.describe('escape in dialogs (desktop)', () => {
  test.skip(
    ({ viewport }) => (viewport?.width ?? 0) < 768,
    'CDK dialog pins run on the desktop project',
  );

  test('Escape closes the delete confirmation and keeps the entry', async ({ page }) => {
    await page.goto('/');
    await importLorebook(page, FATE_PATH);
    await page
      .locator('.entry-item')
      .first()
      .getByRole('button', { name: 'Delete entry' })
      .click();
    const pane = confirmPane(page);
    await expect(pane).toBeVisible();
    // The focus trap parks focus inside the pane once opening completes —
    // Escape pressed before that lands on the still-focused opener and is
    // lost (probe-verified P5: focus sits on the opener through the attach
    // window, and only an in-pane Escape closes).
    await expect(pane.getByRole('button', { name: 'Cancel' })).toBeFocused();

    await page.keyboard.press('Escape'); // CDK default close
    await expect(pane).toBeHidden();
    await expect(page.locator('.entry-item .item-title').first()).toContainText(FIRST_ROW_TITLE);
  });

  test('Escape closes the shortcuts help dialog', async ({ page }) => {
    await page.goto('/');
    await importLorebook(page, FATE_PATH);

    await focusBody(page);
    await page.keyboard.press('?');
    const pane = helpPane(page);
    await expect(pane).toBeVisible();
    await expect(pane.getByRole('button', { name: 'Close keyboard shortcuts' })).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(pane).toBeHidden();
  });
});
