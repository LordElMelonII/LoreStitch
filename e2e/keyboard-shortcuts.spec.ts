import { expect, test, type Page } from '@playwright/test';
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
 * Global chord suite (task 10 §3.8 row "E2E keyboard-shortcuts" + the
 * confirm-flow and help-dialog pins of rows "migrated pins"/"shortcuts help
 * dialog" + the row "Mobile"): the shortcut service resolves each keydown
 * against the pure guard table and the shell dispatches it — these specs pin
 * the USER-VISIBLE contract end to end. P3 grep-verified that no existing
 * spec clicks row-delete or history-Restore, so the confirm pins here are
 * fresh, not migrations.
 *
 * Chord delivery is `page.keyboard.press` with literal modifiers
 * (`Control+s`, `Alt+ArrowDown`, `?`) — `Mod` = Ctrl on this Windows/Linux
 * runner. The tree is dirtied through DISCRETE mutations only (Mod+N appends,
 * Mod+Shift+D toggles) so no text idle-commit window is ever in play; the one
 * debounce the suite waits out is the workspace's ~400 ms IndexedDB save
 * before the reorder-reload pin.
 *
 * Focus facts ride `focusedTarget` (`e2e/helpers.ts`) — `document.activeElement`
 * identity is the discriminator no locator can see.
 */

test.describe.configure({ timeout: 75_000 });

/**
 * The storage layer's debounced save (~400 ms per StorageService.scheduleSave)
 * plus margin, waited out before a reload whose assertions read the persisted
 * working tree. A fixed window over a debounce flush with margin — no DOM fact
 * signals the save landing (round-trip.spec's EDIT_COMMIT_FLUSH_MS precedent).
 */
const SAVE_FLUSH_MS = 700;

/** The shortcuts help pane: centered dialog on tablet/desktop (panel class). */
function helpPane(page: Page): ReturnType<Page['locator']> {
  return page.locator('.cdk-overlay-pane.app-shortcuts-dialog');
}

/** The destructive-action confirm pane: centered dialog on tablet/desktop. */
function confirmPane(page: Page): ReturnType<Page['locator']> {
  return page.locator('.cdk-overlay-pane.app-compact-fullscreen-dialog');
}

/** The destructive-action confirm pane as a bottom sheet on phones. */
function confirmSheet(page: Page): ReturnType<Page['locator']> {
  return page.locator('.cdk-overlay-pane.app-confirm-sheet');
}

/** The history timeline's commit rows (the desktop history drawer opens by default). */
function historyRows(page: Page): ReturnType<Page['locator']> {
  return page.locator('.commit');
}

test.describe('global chords (desktop)', () => {
  test.skip(
    ({ viewport }) => (viewport?.width ?? 0) < 768,
    'desktop-pinned chord pins; phones run the mobile describe below',
  );

  test('Mod+S commits a dirty tree with the auto-message and snacks the hash', async ({
    page,
  }) => {
    await page.goto('/');
    await importLorebook(page, FATE_PATH);
    await expect(historyRows(page)).toHaveCount(1); // the import's initial commit

    // Dirty the tree through a discrete (immediate) mutation — Mod+N appends
    // an entry with no idle-commit window in play.
    await focusBody(page);
    await page.keyboard.press('Control+n');
    await expect(page.locator('[aria-label^="Close tab "]')).toHaveCount(4);

    await focusBody(page);
    await page.keyboard.press('Control+s');
    await expectSnackbar(page, 'Committed');

    // The new head carries the auto-message's stable prefix; the local
    // timestamp is volatile, so only its shape is pinned.
    await expect(page.locator('.commit .msg.head')).toContainText('Snapshot ·');
    await expect(historyRows(page)).toHaveCount(2);
  });

  test('Mod+S on a clean tree snacks "Nothing to commit." and adds no history row', async ({
    page,
  }) => {
    await page.goto('/');
    await importLorebook(page, FATE_PATH);
    await expect(historyRows(page)).toHaveCount(1);

    await focusBody(page);
    await page.keyboard.press('Control+s');
    await expectSnackbar(page, 'Nothing to commit.');
    await expect(historyRows(page)).toHaveCount(1);
  });

  test('Mod+N appends an entry and the active tab body name input holds focus', async ({
    page,
  }) => {
    await page.goto('/');
    await importLorebook(page, FATE_PATH);
    await expect(page.locator('[aria-label^="Close tab "]')).toHaveCount(3);

    await focusBody(page);
    await page.keyboard.press('Control+n');

    await expect(page.locator('[aria-label^="Close tab "]')).toHaveCount(4);
    // The ACTIVE tab body's input — unscoped queries hit the hidden inert
    // copies the inactive mat-tabs keep in the DOM.
    const nameInput = activeEditorPane(page).getByLabel('Entry name');
    await expect(nameInput).toBeFocused();
    await expect(nameInput).toHaveValue(/^New entry \d+$/);
  });

  test('Mod+F focuses the sidebar quick-filter', async ({ page }) => {
    await page.goto('/');
    await importLorebook(page, FATE_PATH);

    await focusBody(page);
    await page.keyboard.press('Control+f');
    await expect(page.getByLabel('Filter entries')).toBeFocused();
  });

  test('Alt+ArrowDown moves the active entry and leaves DOM focus alone', async ({ page }) => {
    await page.goto('/');
    await importLorebook(page, FATE_PATH);
    const firstTitle = await entryRowTitle(page, 0);
    const nextTitle = await entryRowTitle(page, 1);
    await expect(page.locator('.entry-item.active .item-title')).toContainText(firstTitle);

    await focusBody(page); // 'other' scope — not text, not the list
    await page.keyboard.press('Alt+ArrowDown');

    // The ACTIVE row identity moved one step down; from 'other' scope the
    // roving focus must NOT have followed (still on body).
    await expect(page.locator('.entry-item.active .item-title')).toContainText(nextTitle);
    await expect
      .poll(() => page.evaluate(() => document.activeElement === document.body))
      .toBe(true);
  });

  test('J and K move the active entry with roving focus from the list', async ({ page }) => {
    await page.goto('/');
    await importLorebook(page, FATE_PATH);
    const secondTitle = await entryRowTitle(page, 1);
    const thirdTitle = await entryRowTitle(page, 2);

    // Focus a row: clicking it also opens it (idempotent) and makes it the
    // active roving stop with DOM focus on the row.
    await page.locator('.entry-item').nth(1).click();
    await expect(page.locator('.entry-item.active .item-title')).toContainText(secondTitle);
    const rowId = (await focusedTarget(page)).entryId;
    expect(rowId).not.toBeNull();

    // J (list scope): next entry, focus follows the row.
    await page.keyboard.press('j');
    await expect
      .poll(async () => {
        const info = await focusedTarget(page);
        return info.isRow && info.isCurrent && info.entryId !== rowId;
      })
      .toBe(true);
    await expect(page.locator('.entry-item.active .item-title')).toContainText(thirdTitle);

    // K steps back the same way.
    await page.keyboard.press('k');
    await expect
      .poll(async () => (await focusedTarget(page)).entryId)
      .toBe(rowId);
    await expect(page.locator('.entry-item.active .item-title')).toContainText(secondTitle);
  });

  test('Alt+Shift+ArrowDown reorders the active entry and survives a reload', async ({ page }) => {
    await page.goto('/');
    await importLorebook(page, FATE_PATH);
    const firstTitle = await entryRowTitle(page, 0);
    const secondTitle = await entryRowTitle(page, 1);

    await focusBody(page); // 'other' scope
    await page.keyboard.press('Alt+Shift+ArrowDown');

    const titles = page.locator('.entry-item .item-title');
    await expect(titles.first()).toContainText(secondTitle);
    await expect(titles.nth(1)).toContainText(firstTitle);

    // The debounced workspace save must land before the reload or the reorder
    // never reaches IndexedDB (fixed flush window — no DOM fact signals it).
    await page.waitForTimeout(SAVE_FLUSH_MS);
    await page.reload();
    await page.locator('[aria-label="More actions menu"]').waitFor({ state: 'visible' });
    await expect(page.locator('.entry-item').first()).toBeVisible();

    await expect(page.locator('.entry-item .item-title').first()).toContainText(secondTitle);
    await expect(page.locator('.entry-item .item-title').nth(1)).toContainText(firstTitle);
  });

  test('Mod+Shift+D toggles the active entry enabled state both ways', async ({ page }) => {
    await page.goto('/');
    await importLorebook(page, FATE_PATH);
    const activeRow = page.locator('.entry-item.active');
    await expect(activeRow).not.toHaveClass(/disabled-entry/);

    await focusBody(page); // 'other' scope
    await page.keyboard.press('Control+Shift+D');
    await expect(activeRow).toHaveClass(/disabled-entry/);

    await page.keyboard.press('Control+Shift+D');
    await expect(activeRow).not.toHaveClass(/disabled-entry/);
  });

  test('typing jk and ? into the filter inserts characters (no-hijack)', async ({ page }) => {
    await page.goto('/');
    await importLorebook(page, FATE_PATH);
    const nameInput = activeEditorPane(page).getByLabel('Entry name');
    const activeTitle = await nameInput.inputValue();

    await page.keyboard.press('Control+f'); // filter focused and selected
    await page.keyboard.type('jk');
    const filter = page.getByLabel('Filter entries');
    await expect(filter).toHaveValue('jk');
    // Bare letters never fire outside 'list' scope: the active entry is
    // exactly where the import left it.
    await expect(nameInput).toHaveValue(activeTitle);

    // '?' in text scope types — the help dialog did not open.
    await page.keyboard.press('?');
    await expect(filter).toHaveValue('jk?');
    await expect(helpPane(page)).toHaveCount(0);
    await expect(nameInput).toHaveValue(activeTitle);
  });
});

test.describe('shortcuts help dialog (desktop)', () => {
  test.skip(
    ({ viewport }) => (viewport?.width ?? 0) < 768,
    'the centered dialog only opens at viewport widths >= 768px',
  );

  test('? opens it from the shell; the catalog renders Mod+S and ?; Escape closes', async ({
    page,
  }) => {
    await page.goto('/');
    await importLorebook(page, FATE_PATH);

    await focusBody(page);
    await page.keyboard.press('?');

    const pane = helpPane(page);
    await expect(pane).toBeVisible();
    await expect(pane.getByRole('heading', { name: 'Keyboard shortcuts' })).toBeVisible();
    // The catalog renders the resolver's own table, grouped per its scope
    // column — including the ? entry that documents itself.
    await expect(pane.getByRole('heading', { name: 'Everywhere' })).toBeVisible();
    await expect(pane.getByRole('heading', { name: 'In the entry list' })).toBeVisible();
    await expect(pane.locator('kbd').filter({ hasText: /^Mod\+S$/ })).toHaveText('Mod+S');
    await expect(pane.locator('kbd').filter({ hasText: /^\?$/ })).toHaveText('?');

    // The focus trap parks focus inside the pane once opening completes —
    // Escape before that lands on the still-focused opener and is lost
    // (probe-verified P5; see keyboard-navigation.spec.ts's delete pin).
    await expect(pane.getByRole('button', { name: 'Close keyboard shortcuts' })).toBeFocused();
    await page.keyboard.press('Escape'); // CDK default close
    await expect(pane).toBeHidden();
  });

  test('the topbar More-actions item opens it', async ({ page }) => {
    await page.goto('/');
    await importLorebook(page, FATE_PATH);

    await page.locator('[aria-label="More actions menu"]').click();
    await page.getByRole('menuitem', { name: 'Keyboard shortcuts…' }).click();

    await expect(helpPane(page)).toBeVisible();
    await expect(helpPane(page).getByRole('heading', { name: 'Keyboard shortcuts' })).toBeVisible();
  });

  test('chords are inert while a dialog is open', async ({ page }) => {
    await page.goto('/');
    await importLorebook(page, FATE_PATH);
    await expect(historyRows(page)).toHaveCount(1);

    // Dirty the tree so a live Mod+S inside the dialog would be observable as
    // a second history row — inertness must not ride the clean-tree path.
    await focusBody(page);
    await page.keyboard.press('Control+n');
    await expect(page.locator('[aria-label^="Close tab "]')).toHaveCount(4);
    await focusBody(page);

    await page.keyboard.press('?');
    const pane = helpPane(page);
    await expect(pane).toBeVisible();

    // Every chord stays inert under the overlay gate: no second help pane
    // from a second ?, no commit from Mod+S on the dirty tree.
    await page.keyboard.press('?');
    await expect(page.locator('.cdk-overlay-pane.app-shortcuts-dialog')).toHaveCount(1);
    await page.keyboard.press('Control+s');
    await expect(pane).toBeVisible();
    await expect(page.locator('.cdk-overlay-pane.app-shortcuts-dialog')).toHaveCount(1);
    await expect(historyRows(page)).toHaveCount(1);

    // Focus-trap settle before Escape (see the help-dialog Escape pin above).
    await expect(pane.getByRole('button', { name: 'Close keyboard shortcuts' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(pane).toBeHidden();

    // Control: the same Mod+S OUTSIDE the dialog commits — the inertness
    // above was the overlay gate, not a broken chord pipeline.
    await page.keyboard.press('Control+s');
    await expectSnackbar(page, 'Committed');
    await expect(historyRows(page)).toHaveCount(2);
  });
});

test.describe('single-entry delete confirmation (desktop)', () => {
  test.skip(
    ({ viewport }) => (viewport?.width ?? 0) < 768,
    'desktop dialog pins; phones pin the bottom sheet below',
  );

  test('cancel keeps the entry; accept deletes it', async ({ page }) => {
    await page.goto('/');
    await importLorebook(page, FATE_PATH);
    const firstTitle = page.locator('.entry-item .item-title').first();
    await expect(firstTitle).toContainText(FIRST_ROW_TITLE);

    const deleteButton = page
      .locator('.entry-item')
      .first()
      .getByRole('button', { name: 'Delete entry' });
    await deleteButton.click();

    const pane = confirmPane(page);
    await expect(pane).toBeVisible();
    await expect(pane.getByRole('heading', { name: 'Delete entry' })).toBeVisible();
    await expect(pane.locator('.message')).toContainText(
      `Delete “${FIRST_ROW_TITLE}”? This cannot be undone.`,
    );

    await pane.getByRole('button', { name: 'Cancel' }).click();
    await expect(pane).toBeHidden();
    await expect(firstTitle).toContainText(FIRST_ROW_TITLE);

    await deleteButton.click();
    await pane.getByRole('button', { name: 'Delete' }).click();
    await expect(pane).toBeHidden();
    await expect(firstTitle).not.toContainText(FIRST_ROW_TITLE);
  });
});

test.describe('history restore confirmation (desktop)', () => {
  test.skip(
    ({ viewport }) => (viewport?.width ?? 0) < 768,
    'desktop dialog pins; the desktop history drawer opens by default',
  );

  test('cancel keeps the working tree; accept rolls back', async ({ page }) => {
    await page.goto('/');
    await importLorebook(page, FATE_PATH);

    // Dirty the tree through a discrete mutation: the active entry flips to
    // disabled — the rollback must undo exactly this.
    await focusBody(page);
    await page.keyboard.press('Control+Shift+D');
    await expect(page.locator('.entry-item.active')).toHaveClass(/disabled-entry/);

    const restoreInitial = page.getByRole('button', {
      name: 'Restore Initial commit: 70 entries',
    });
    await restoreInitial.click();

    const pane = confirmPane(page);
    await expect(pane).toBeVisible();
    await expect(pane.getByRole('heading', { name: 'Restore this state?' })).toBeVisible();
    await expect(pane.locator('.message')).toContainText(
      'Every uncommitted change made since this commit will be discarded.',
    );

    await pane.getByRole('button', { name: 'Cancel' }).click();
    await expect(pane).toBeHidden();
    await expect(page.locator('.entry-item.active')).toHaveClass(/disabled-entry/);

    await restoreInitial.click();
    await pane.getByRole('button', { name: 'Restore' }).click();
    await expect(pane).toBeHidden();

    // The rollback lands: the working tree returns to the initial commit.
    await expect(page.locator('.entry-item.active')).not.toHaveClass(/disabled-entry/);
    await expect(page.locator('.clean-note')).toBeVisible();
  });
});

test.describe('delete confirmation on phones (bottom sheet)', () => {
  test.skip(
    ({ viewport }) => (viewport?.width ?? 0) >= 768,
    'the bottom sheet only opens at viewport widths < 768px',
  );

  test('the confirm renders as a sheet; cancel keeps the entry, accept deletes it', async ({
    page,
  }) => {
    await page.goto('/');
    await importLorebook(page, FATE_PATH);
    // Phones boot with the entries drawer closed.
    await page.locator('[aria-label="Toggle entries panel"]').click();
    await expect(page.getByRole('heading', { name: 'Entries' })).toBeVisible();

    const firstTitle = page.locator('.entry-item .item-title').first();
    await expect(firstTitle).toContainText(FIRST_ROW_TITLE);

    // Touch surfaces keep the row ghost buttons permanently revealed
    // (hover-reveal is desktop-only CSS), so the delete affordance is tappable.
    const deleteButton = page
      .locator('.entry-item')
      .first()
      .getByRole('button', { name: 'Delete entry' });
    await deleteButton.click();

    const sheet = confirmSheet(page);
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('.mat-bottom-sheet-container')).toBeVisible();
    await expect(sheet.getByRole('heading', { name: 'Delete entry' })).toBeVisible();
    await expect(sheet.locator('.message')).toContainText(
      `Delete “${FIRST_ROW_TITLE}”? This cannot be undone.`,
    );

    await sheet.getByRole('button', { name: 'Cancel' }).click();
    await expect(sheet).toBeHidden();
    await expect(firstTitle).toContainText(FIRST_ROW_TITLE);

    await deleteButton.click();
    await sheet.getByRole('button', { name: 'Delete' }).click();
    await expect(sheet).toBeHidden();
    await expect(firstTitle).not.toContainText(FIRST_ROW_TITLE);
  });
});

test.describe('keyboard chords on phones', () => {
  test.skip(
    ({ viewport }) => (viewport?.width ?? 0) >= 768,
    'phone layout pins; desktop runs the chord describes above',
  );

  test('typing into the filter is never hijacked and keydowns never crash the shell', async ({
    page,
  }) => {
    await page.goto('/');
    await importLorebook(page, FATE_PATH);
    await page.locator('[aria-label="Toggle entries panel"]').click();
    await expect(page.getByRole('heading', { name: 'Entries' })).toBeVisible();
    const activeTitle = await activeEditorPane(page).getByLabel('Entry name').inputValue();

    const filter = page.getByLabel('Filter entries');
    await filter.click();
    await page.keyboard.type('jk');
    await expect(filter).toHaveValue('jk');
    await page.keyboard.press('?');
    await expect(filter).toHaveValue('jk?');

    // Text-scope keydowns: no help pane opened, and the shell underneath is
    // still interactive (nothing crashed on keydown).
    await expect(helpPane(page)).toHaveCount(0);
    await expect(page.locator('[aria-label="More actions menu"]')).toBeVisible();

    // Alt+ArrowDown in a text field is a text-navigation chord — unclaimed by
    // the resolver: no entry navigation fired (the editor keeps its
    // import-time tab).
    await page.keyboard.press('Alt+ArrowDown');
    await expect(activeEditorPane(page).getByLabel('Entry name')).toHaveValue(activeTitle);
    await expect(filter).toHaveValue('jk?');
  });

  test('the bottom bar still covers new-entry and commit', async ({ page }) => {
    await page.goto('/');
    await importLorebook(page, FATE_PATH);
    const bar = page.locator('app-mobile-bottom-bar nav[aria-label="Quick actions"]');

    await bar.locator('.bar-item').filter({ hasText: 'New entry' }).click();
    await expect(activeEditorPane(page).getByLabel('Entry name')).toHaveValue(/^New entry \d+$/);

    await bar.locator('[aria-label="Toggle history drawer"]').click();
    await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();
    await expect(page.getByLabel('Commit message')).toBeVisible();
    // exact: the substring default would also match the history rows'
    // "Toggle diff for Initial commit…" and "Restore Initial commit…" buttons.
    await expect(page.getByRole('button', { name: 'Commit', exact: true })).toBeVisible();
  });
});
