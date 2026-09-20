import { expect, type Locator, type Page, test } from '@playwright/test';
import { createProject, FATE_PATH, importLorebook, openFirstEntry } from './helpers';

/**
 * Regex key testing sandbox (Task 04 plan §5, Tier 3), driven through the
 * real user path against the bundled Fate/Stay Night fixture:
 *
 *  1. Import the fixture, open the first entry, expand the entry options
 *     panel and add `/(?:saber|artoria)/i`, `excalibur`, `grail` (and the
 *     secondary `avalon`) through the real chip inputs. Chips classify: the
 *     regex key gets the quiet `functions` accent, plain keys stay untouched.
 *  2. The "Test keys" section is collapsed by default with its content
 *     `inert`; the toggle flips `aria-expanded` and releases the panel.
 *  3. A sample text drives the per-key match rows and the highlighted
 *     preview live: the non-global regex key paints only its FIRST match,
 *     plaintext keys paint every occurrence.
 *  4. A malformed key `/(saber/` flags its chip (`key-invalid` + error
 *     glyph) and renders the "treated as plain text" row state.
 *  5. Flipping "Match Whole Words" (Matching Sources section) flips the
 *     substring-only `grail` hit to No match while the whole-word
 *     `excalibur` hit, the options-immune regex key and the secondary hit
 *     stay — no reload (the component-local sample survives in the field).
 *  6. The "Showing first 200 matches" clamp note is absent for a small
 *     sample and appears once the sample floods past the clamp.
 *  7. A fresh keyless entry renders no Test keys section at all (mount
 *     gating).
 *
 * The fixture's first entry (uid 1) is Selective with seven plaintext keys
 * and no regex/invalid keys, so the classification assertions below are
 * unambiguous; its `match_whole_words` is `null` (ST default `false`), which
 * is exactly the state the whole-word flip starts from.
 */

/** The key regex added through the chip input (non-global: first match only). */
const REGEX_KEY = '/(?:saber|artoria)/i';

/**
 * The sample the sandbox evaluates. `grail` occurs only inside
 * "Grailbearer" — a substring-only hit that whole-word matching must flip to
 * No match — while `excalibur` and the secondary `avalon` sit between word
 * boundaries and survive the flip.
 */
const SAMPLE = 'Artoria raised Excalibur as Saber… the Grailbearer walked on. Avalon answered.';

/** The active entry editor pane — inactive mat-tabs keep their DOM. */
function editor(page: Page): Locator {
  return page.locator('.mat-mdc-tab-body-active');
}

/** Anchored matcher for a rendered key text (case-sensitive, whole string). */
function keyText(key: string): RegExp {
  return new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
}

/**
 * The sandbox match row for exactly `key`. Anchored so the fixture's own
 * plaintext keys ("Greater Grail" vs the added `grail`) can never collide.
 * The `has` locator is page-rooted: filter({ has }) re-roots it below the
 * outer element, so an ancestor-prefixed chain (the tab body) would never
 * match inside a row.
 */
function matchRow(page: Page, scope: Locator, key: string): Locator {
  return scope.locator('.match-row').filter({
    has: page.locator('.row-key').filter({ hasText: keyText(key) }),
  });
}

/** Adds one key through a chip input (the real Enter-to-commit user path). */
async function addChipKey(input: Locator, key: string): Promise<void> {
  await input.fill(key);
  await input.press('Enter');
}

/**
 * Adds a fresh (keyless) entry from the list's "New entry" button,
 * viewport-aware: on a phone the button lives inside the off-canvas entries
 * drawer, which is toggled open before and released after the click.
 */
async function addNewEntry(page: Page): Promise<void> {
  const viewport = page.viewportSize();
  const mobile = viewport !== null && viewport.width < 768;
  const drawerToggle = page.locator('[aria-label="Toggle entries panel"]');
  const listAddButton = page.locator('app-entry-list [aria-label="New entry"]');
  if (mobile && !(await listAddButton.isVisible())) {
    await drawerToggle.click();
    await expect(page.getByRole('heading', { name: 'Entries' })).toBeVisible();
  }
  await listAddButton.click();
  await expect(page.locator('app-entry-editor .entry-tabs')).toBeVisible();
  if (mobile) {
    await drawerToggle.click();
    await expect(page.locator('.entries-sidenav')).not.toBeInViewport();
  }
}

test.describe('regex key sandbox (Test keys panel)', () => {
  // Importing the 70-entry fixture plus the panel interactions is a long
  // flow; the default 30s budget is tight for a cold mobile run.
  test.describe.configure({ timeout: 90_000 });
  // One desktop + one mobile pass is the intent (plan §5 names mobile-chrome);
  // the iPhone 14 project would only replay that leg on the second engine.
  test.skip(
    () => test.info().project.name === 'mobile-safari',
    'the desktop-chrome and mobile-chrome projects cover this flow',
  );

  test('sandbox classifies chips, matches the sample live and honors whole words', async ({
    page,
  }) => {
    await page.goto('/');
    await importLorebook(page, FATE_PATH);
    await openFirstEntry(page);

    const tab = editor(page);

    // Expand the entry options panel (collapsed by default) and scope every
    // editor assertion below to the active tab body.
    const optionsToggle = tab.getByRole('button', { name: 'Toggle entry options' });
    await optionsToggle.click();
    await expect(optionsToggle).toHaveAttribute('aria-expanded', 'true');

    const primaryKeyInput = tab.getByLabel('Add primary key');
    for (const key of [REGEX_KEY, 'excalibur', 'grail']) {
      await addChipKey(primaryKeyInput, key);
    }
    await addChipKey(tab.getByLabel('Add secondary key'), 'avalon');

    // Chip classification (§3.2): exactly one regex chip, carrying the quiet
    // functions accent glyph; the plain chips stay unclassified.
    const regexChip = tab.locator('.mat-mdc-chip-row.key-regex');
    await expect(regexChip).toHaveCount(1);
    await expect(regexChip).toContainText(REGEX_KEY);
    await expect(regexChip.locator('mat-icon').filter({ hasText: 'functions' })).toHaveCount(1);
    const plainChip = tab.locator('.mat-mdc-chip-row').filter({ hasText: 'excalibur' });
    await expect(plainChip).toHaveCount(1);
    await expect(plainChip).not.toHaveClass(/key-(regex|invalid)/);

    // The Test keys section is collapsed by default: the toggle carries the
    // ARIA state and the content stays mounted but inert (and invisible).
    const sandboxToggle = tab.locator('.test-keys-toggle');
    const sandboxPanel = tab.locator('.test-panel-anchor');
    // exact: the collapse toggle's aria-label ("Test keys against a sample
    // text") would otherwise substring-match the same query.
    const sampleField = tab.getByLabel('Sample text', { exact: true });
    await expect(sandboxToggle).toHaveAttribute('aria-expanded', 'false');
    expect(
      await sandboxPanel.evaluate((el) => el.hasAttribute('inert')),
      'closed sandbox content must be inert',
    ).toBe(true);
    await expect(sampleField).toBeHidden();

    await sandboxToggle.click();
    await expect(sandboxToggle).toHaveAttribute('aria-expanded', 'true');
    expect(
      await sandboxPanel.evaluate((el) => el.hasAttribute('inert')),
      'open sandbox content must not be inert',
    ).toBe(false);
    await expect(sampleField).toBeVisible();

    // Filling the sample drives rows and the preview with no further action.
    await sampleField.fill(SAMPLE);

    await expect(matchRow(page, tab, REGEX_KEY).locator('.row-state')).toHaveText('Matches');
    await expect(matchRow(page, tab, 'excalibur').locator('.row-state')).toHaveText('Matches');
    await expect(matchRow(page, tab, 'grail').locator('.row-state')).toHaveText('Matches');
    // Secondary rows carry their selective-logic context label.
    await expect(matchRow(page, tab, 'avalon').locator('.row-state')).toHaveText('Matches');
    await expect(matchRow(page, tab, 'avalon').locator('.logic-chip')).toHaveText('AND Any');

    // The highlighted preview paints primary-tone spans over every primary
    // hit and secondary-tone spans over the secondary hit — in document
    // order. The non-global regex key paints only its FIRST match: the later
    // "Saber" occurrence must stay unhighlighted.
    const preview = tab.locator('.preview');
    await expect(preview).toBeVisible();
    await expect(preview.locator('.tone-primary')).toHaveText([
      'Artoria',
      'Excalibur',
      'Grail',
    ]);
    await expect(preview.locator('.tone-secondary')).toHaveText(['Avalon']);
    await expect(preview.locator('.tone-primary', { hasText: keyText('Saber') })).toHaveCount(0);

    // The matched row locates its first plaintext hit.
    await expect(matchRow(page, tab, 'excalibur').locator('.row-excerpt')).toContainText('Excalibur');

    // A small sample stays far below the highlight clamp.
    await expect(tab.getByText('Showing first 200 matches')).toHaveCount(0);

    // A malformed regex key flags its chip loudly ...
    await addChipKey(primaryKeyInput, '/(saber/');
    const invalidChip = tab.locator('.mat-mdc-chip-row.key-invalid');
    await expect(invalidChip).toHaveCount(1);
    await expect(invalidChip).toContainText('/(saber/');
    await expect(invalidChip.locator('mat-icon').filter({ hasText: 'error' })).toHaveCount(1);

    // ... and its row names the plaintext fall-back instead of a match state.
    await expect(matchRow(page, tab, '/(saber/').locator('.row-state')).toHaveText(
      'Invalid regex — treated as plain text',
    );

    // Flipping Match Whole Words (null "Default" -> Enabled) recomputes
    // live: the substring-only grail hit flips to No match while the
    // whole-word hits stay and the regex key ignores the option entirely.
    const wholeWords = tab.getByRole('combobox', { name: 'Match Whole Words' });
    await wholeWords.click();
    await page.getByRole('option', { name: 'Enabled', exact: true }).click();

    await expect(matchRow(page, tab, 'grail').locator('.row-state')).toHaveText('No match');
    await expect(matchRow(page, tab, 'excalibur').locator('.row-state')).toHaveText('Matches');
    await expect(matchRow(page, tab, REGEX_KEY).locator('.row-state')).toHaveText('Matches');
    await expect(matchRow(page, tab, 'avalon').locator('.row-state')).toHaveText('Matches');
    await expect(preview.locator('.tone-primary')).toHaveText(['Artoria', 'Excalibur']);
    await expect(preview.locator('.tone-secondary')).toHaveText(['Avalon']);
    // The component-local sample survives in the field — nothing reloaded.
    await expect(sampleField).toHaveValue(SAMPLE);

    // A sample flooding past the 200-highlight clamp shows the clamp note.
    // Tokens are separated by TWO spaces: ST's whole-word boundary pattern
    // `(?:^|\W)(key)(?:$|\W)` consumes the boundary it matches, so single-
    // space repeats would only match every other occurrence (101 < 200) —
    // this way every occurrence keeps a leading boundary of its own.
    await sampleField.fill('excalibur  '.repeat(201));
    await expect(tab.getByText('Showing first 200 matches')).toHaveCount(1);
  });

  test('a keyless entry renders no Test keys section', async ({ page }) => {
    await createProject(page, 'E2E Regex Sandbox');
    await addNewEntry(page);

    const tab = editor(page);
    const optionsToggle = tab.getByRole('button', { name: 'Toggle entry options' });
    await optionsToggle.click();
    await expect(optionsToggle).toHaveAttribute('aria-expanded', 'true');

    // Mount gating (§3.3): with no keys there is nothing to test — no
    // header, no toggle, no panel body.
    await expect(tab.locator('app-regex-test-panel .test-keys-header')).toHaveCount(0);
    await expect(tab.locator('.test-keys-toggle')).toHaveCount(0);
  });
});
