import { join } from 'node:path';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { importLorebook } from './helpers';

/**
 * Lorebook health linter acceptance suite (Task 03, plan §3.4 Tier 3):
 *
 * Drives the real linter end to end against the dedicated five-defect fixture
 * `example_card/linter-demo.lorebook.json` (ST-native format, imported through
 * the welcome picker). The fixture's expected diagnostic map — pinned against
 * `lintBook` when the fixture was authored — is:
 *
 *   2 errors    · invalid-regex (uid 6, `/dragons[fire/` does not compile)
 *               · malformed-wrapper (uid 7, `<Castle>…</Kingdom>` mismatched)
 *   4 warnings  · duplicate-key (uid 0 + 1 share `Silver Sword`)
 *               · secondary-keys-ignored ×2 (uid 2 constant, uid 3 not selective)
 *               · recursion-cycle (uid 4 ↔ 5, Moonshard ↔ Sunwell)
 *   0 notes     · the healthy entry (uid 8) stays clean
 *
 *  1. Desktop: import → badge shows 6 → open the pane from the topbar →
 *     summary + section headings + messages from every defect class →
 *     `Go to entry` on the invalid-regex row selects the entry in the editor →
 *     fixing the key through the editor's chip field drops the badge to 5
 *     (automatic recompute, no refresh).
 *  2. Desktop amendment: the mute chips are the entry editor's filter-chip
 *     pattern (mat-chip-option: selected = check on, deselected = muted) —
 *     mute a chip → its row disappears and the summary drops; unmute → it
 *     returns; muting EVERY chip keeps the mute row above the empty state.
 *     Multi-entry rows jump through named stroked buttons. Mark a row
 *     `Not an issue` → the footer counts it; `Undo all` → the row and clean
 *     summary return.
 *  3. Phone: the pane opens as the `app-linter-sheet` bottom sheet through
 *     the More menu (the only reach on phones — the bar button is
 *     desktop-only), showing the same summary and rows.
 */

const FIXTURE_PATH = join(process.cwd(), 'example_card', 'linter-demo.lorebook.json');

/** The broken regex key and its repaired replacement (desktop fix flow). */
const BAD_KEY = '/dragons[fire/';
const FIXED_KEY = 'Old Charm';

/** Expected pane summary for the untouched fixture (§3.6.2 copy, pluralized). */
const FULL_SUMMARY = '2 errors · 4 warnings · 0 notes';

/** The topbar health-check button's numeric badge (`matBadge` on the icon). */
function healthBadge(page: Page): Locator {
  return page.locator('[aria-label="Health check"] .mat-badge-content');
}

/**
 * Opens the health check pane from the desktop-only topbar button. The pane
 * is lazy-loaded, so wait for the component rather than racing the import.
 */
async function openLinterFromTopbar(page: Page): Promise<void> {
  await page.locator('[aria-label="Health check"]').click();
  await expect(page.locator('app-linter-dialog')).toBeVisible();
}

/** The health check pane's component host (exactly one is open at a time). */
function linterPane(page: Page): Locator {
  return page.locator('app-linter-dialog');
}

/**
 * The active entry tab's body. Inactive tabs keep their DOM — including every
 * editor input — so editor interactions must be scoped here or Playwright's
 * strict mode trips over one control per open tab.
 */
function activeTabBody(page: Page): Locator {
  return page.locator('.entry-tabs .mat-mdc-tab-body-active');
}

/**
 * Expands the active entry's options accordion if collapsed. The expanded
 * state is shared studio-wide, so it may already be open (the round-trip
 * pattern).
 */
async function ensureEntryOptionsOpen(page: Page): Promise<void> {
  const panel = activeTabBody(page).locator('[role="region"][aria-label*="Placement, activation"]');
  if ((await panel.getAttribute('inert')) !== null) {
    await activeTabBody(page).locator('[aria-label="Toggle entry options"]').click();
  }
  await expect(panel).not.toHaveAttribute('inert');
}

test.describe('linter desktop flows', () => {
  // Boot + import + pane interactions is a long interaction; the sibling
  // suites budget 90s for the same reason (cold dev-server compile).
  test.describe.configure({ timeout: 90_000 });
  test.use({ viewport: { width: 1920, height: 1080 } });
  // Project gate (plan §3.5.5): the topbar-button flow pins a desktop
  // viewport (the button is `desktop-only` and hidden on phones by design);
  // the phone leg below runs on the mobile projects via the More menu.
  test.skip(
    () => test.info().project.name.startsWith('mobile-'),
    'desktop-pinned linter flow runs on the desktop project only',
  );

  test('import shows the badge, the pane lists every defect class, and go-to-entry enables the fix', async ({
    page,
  }) => {
    await page.goto('/');
    await importLorebook(page, FIXTURE_PATH);

    // Badge: errors + warnings = 6 diagnostics (info never counts).
    await expect(healthBadge(page)).toHaveText('6');

    await openLinterFromTopbar(page);
    const pane = linterPane(page);

    // Summary line (all three counts always shown) and severity sections.
    await expect(pane.locator('.summary')).toHaveText(FULL_SUMMARY);
    await expect(pane.getByRole('heading', { name: 'Errors (2)' })).toBeVisible();
    await expect(pane.getByRole('heading', { name: 'Warnings (4)' })).toBeVisible();
    // Notes is empty on this fixture, and empty sections never render.
    await expect(pane.getByRole('heading', { name: /Notes/ })).toHaveCount(0);

    // A recognizable message from every defect class (core `message` copy).
    await expect(
      pane.locator('li.diagnostic-row', { hasText: 'not a valid regex' }),
    ).toContainText('Entry "Broken Charm"');
    await expect(
      pane.locator('li.diagnostic-row', { hasText: 'malformed whole-content wrapper' }),
    ).toContainText('Entry "Sunlit Grove"');
    await expect(
      pane.locator('li.diagnostic-row', { hasText: "share the primary key 'Silver Sword'" }),
    ).toBeVisible();
    await expect(
      pane.locator('li.diagnostic-row', {
        hasText: 'may activate during recursion in a loop',
      }),
    ).toContainText('"Cycle: Moonshard" and "Cycle: Sunwell"');
    // Multi-entry rows jump through named stroked buttons, one per entry
    // (post-acceptance fix — chips did not read as clickable).
    const duplicateRow = pane.locator('li.diagnostic-row', {
      hasText: "share the primary key 'Silver Sword'",
    });
    await expect(duplicateRow).toBeVisible();
    await expect(duplicateRow.locator('.jump-button')).toHaveCount(2);
    await expect(duplicateRow.locator('.jump-button', { hasText: 'Twinblade Legacy' })).toBeVisible();
    await expect(duplicateRow.locator('.jump-button', { hasText: 'Silver Sword Lore' })).toBeVisible();
    await expect(
      pane.locator('li.diagnostic-row', { hasText: 'is constant — SillyTavern ignores all' }),
    ).toBeVisible();

    // Monospace details lines: the offending key and the cycle path.
    await expect(pane.locator('.details', { hasText: BAD_KEY })).toBeVisible();
    await expect(
      pane.locator('.details', { hasText: 'Cycle: Moonshard → Cycle: Sunwell → Cycle: Moonshard' }),
    ).toBeVisible();

    // Click-through on the invalid-regex row: the pane closes and the editor
    // selects that entry (same mechanism as the entry list).
    await pane.getByRole('button', { name: 'Go to entry: Broken Charm' }).click();
    await expect(page.locator('app-linter-dialog')).toBeHidden();
    await expect(page.locator('app-entry-editor .entry-tabs')).toBeVisible();
    await expect(page.getByRole('tab', { name: /Broken Charm/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(activeTabBody(page).locator('[aria-label="Entry content"]')).toHaveValue(
      'A charm said to break when spoken aloud.',
    );

    // Fix the invalid regex through the entry editor's keys field: remove the
    // broken key chip, add a valid one.
    await ensureEntryOptionsOpen(page);
    await activeTabBody(page)
      .getByRole('button', { name: `Remove key ${BAD_KEY}` })
      .click();
    const keyInput = activeTabBody(page).locator('input[aria-label="Add primary key"]');
    await keyInput.fill(FIXED_KEY);
    await keyInput.press('Enter');
    await expect(
      activeTabBody(page).getByRole('button', { name: `Remove key ${FIXED_KEY}` }),
    ).toBeVisible();

    // The badge recomputes automatically (invalid-regex error gone): 6 → 5.
    await expect(healthBadge(page)).toHaveText('5');

    // Re-opening the pane confirms the recomputed summary without a refresh.
    await openLinterFromTopbar(page);
    await expect(linterPane(page).locator('.summary')).toHaveText('1 error · 4 warnings · 0 notes');
    await expect(
      linterPane(page).locator('li.diagnostic-row', { hasText: 'not a valid regex' }),
    ).toHaveCount(0);
    await linterPane(page).getByRole('button', { name: 'Close health check' }).click();
    await expect(page.locator('app-linter-dialog')).toBeHidden();
  });

  test('muting a rule chip hides and restores its row; not-an-issue footer undoes', async ({
    page,
  }) => {
    await page.goto('/');
    await importLorebook(page, FIXTURE_PATH);
    await openLinterFromTopbar(page);
    const pane = linterPane(page);

    // One chip per rule present in the unfiltered pass — the fixture emits
    // five distinct rules, so all five chips render. Chips follow the entry
    // editor's filter pattern: aria-selected = the check runs.
    const muteRow = pane.locator('.mute-row');
    const option = (name: string) => muteRow.getByRole('option', { name });
    await expect(option('Duplicate keys')).toBeVisible();
    await expect(option('Invalid regex')).toBeVisible();
    await expect(option('Recursion cycles')).toBeVisible();
    await expect(option('Malformed wrappers')).toBeVisible();
    await expect(option('Ignored secondary keys')).toBeVisible();

    // Mute Duplicate keys (deselect the chip): its row disappears and the
    // summary drops — no other warning is affected.
    const duplicateChip = option('Duplicate keys');
    await expect(duplicateChip).toHaveAttribute('aria-selected', 'true');
    await duplicateChip.click();
    await expect(duplicateChip).toHaveAttribute('aria-selected', 'false');
    await expect(
      pane.locator('li.diagnostic-row', { hasText: "share the primary key 'Silver Sword'" }),
    ).toHaveCount(0);
    await expect(pane.locator('.summary')).toHaveText('2 errors · 3 warnings · 0 notes');

    // Re-select the chip: the row returns with the same message.
    await duplicateChip.click();
    await expect(duplicateChip).toHaveAttribute('aria-selected', 'true');
    await expect(
      pane.locator('li.diagnostic-row', { hasText: "share the primary key 'Silver Sword'" }),
    ).toBeVisible();
    await expect(pane.locator('.summary')).toHaveText(FULL_SUMMARY);

    // Mark one row "Not an issue": the row disappears and the footer counts
    // exactly one ignored issue.
    const invalidRow = pane.locator('li.diagnostic-row', { hasText: 'not a valid regex' });
    await invalidRow.getByRole('button', { name: 'Not an issue' }).click();
    await expect(invalidRow).toHaveCount(0);
    await expect(pane.locator('.ignored-footer .ignored-count')).toHaveText(
      '1 issue marked not-an-issue',
    );
    await expect(pane.locator('.summary')).toHaveText('1 error · 4 warnings · 0 notes');

    // Undo all: the row returns, the footer goes away, mutes untouched.
    await pane.getByRole('button', { name: 'Undo all' }).click();
    await expect(pane.locator('.ignored-footer')).toHaveCount(0);
    await expect(
      pane.locator('li.diagnostic-row', { hasText: 'not a valid regex' }),
    ).toBeVisible();
    await expect(pane.locator('.summary')).toHaveText(FULL_SUMMARY);
  });

  test('muting every check keeps the mute row above the empty state', async ({ page }) => {
    await page.goto('/');
    await importLorebook(page, FIXTURE_PATH);
    await openLinterFromTopbar(page);
    const pane = linterPane(page);

    // Deselect all five chips: the filtered diagnostics drain away…
    const muteRow = pane.locator('.mute-row');
    const chips = muteRow.getByRole('option');
    await expect(chips).toHaveCount(5);
    for (let i = 0; i < 5; i += 1) {
      await chips.nth(i).click();
    }
    await expect(pane.locator('.empty-state')).toBeVisible();
    await expect(pane.locator('.summary')).toHaveText('0 errors · 0 warnings · 0 notes');

    // …but the chip row itself stays: every chip remains, deselected, so the
    // all-muted book keeps its recovery path (issue-2 regression).
    await expect(muteRow).toBeVisible();
    await expect(chips).toHaveCount(5);
    for (let i = 0; i < 5; i += 1) {
      await expect(chips.nth(i)).not.toHaveAttribute('aria-selected', 'true');
    }

    // And a chip is still selectable: unmuting one brings its rows back.
    await muteRow.getByRole('option', { name: 'Invalid regex' }).click();
    await expect(
      pane.locator('li.diagnostic-row', { hasText: 'not a valid regex' }),
    ).toBeVisible();
    await expect(pane.locator('.empty-state')).toHaveCount(0);
    await expect(pane.locator('.summary')).toHaveText('1 error · 0 warnings · 0 notes');
  });
});

test.describe('linter mobile bottom sheet', () => {
  // Cold WebKit/Chromium boot + import + menu choreography; the sibling
  // mobile suites budget 75s for the same reason.
  test.describe.configure({ timeout: 75_000 });
  // Project gate (plan §3.5.5): a phone leg by design — the sheet variant
  // only exists under 768px, so the desktop project would only duplicate the
  // dialog flow. Both mobile projects keep it (WebKit parity).
  test.skip(
    () => test.info().project.name === 'desktop-chrome',
    'phone-pinned linter sheet runs on the mobile projects only',
  );

  test('the More menu opens the health check as a bottom sheet with the same diagnostics', async ({
    page,
  }) => {
    await page.goto('/');
    await importLorebook(page, FIXTURE_PATH);

    // The desktop-only bar button is hidden on phones; the More menu is the
    // universal reach (§3.6.1).
    await page.locator('[aria-label="More actions menu"]').click();
    await page.getByRole('menuitem', { name: /Health check/ }).click();

    // The bottom-sheet container carries the registered `app-linter-sheet`
    // panel class and hosts the same component as the desktop dialog.
    const sheet = page.locator('.app-linter-sheet app-linter-dialog');
    await expect(sheet).toBeVisible();

    await expect(sheet.locator('.summary')).toHaveText(FULL_SUMMARY);
    await expect(sheet.getByRole('heading', { name: 'Errors (2)' })).toBeVisible();
    await expect(sheet.locator('li.diagnostic-row').first()).toBeVisible();

    await sheet.getByRole('button', { name: 'Close health check' }).click();
    await expect(page.locator('.app-linter-sheet')).toBeHidden();
  });
});
