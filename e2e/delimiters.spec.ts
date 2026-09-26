import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { expect, type Locator, type Page, test } from '@playwright/test';
import {
  createProject as createProjectViaWelcomeScreen,
  expectSnackbar,
  exportWorldInfo,
  FATE_PATH,
  importLorebook,
  importViaProjectsMenu,
  openFirstEntry,
  openEntryRow,
  readEntryContent,
  selectFirstTwoRows,
  setEntryContent,
} from './helpers';

/**
 * Delimiter acceptance suite (ROADMAP Tier 3):
 *
 * Delimiters are baked into `entry.content` at apply time — there is no
 * dynamic-insertion pathway — so anything that corrupts them is written
 * straight into an exported SillyTavern file. This suite drives the real
 * dialog end to end against the bundled Fate/Stay Night fixture:
 *
 *  1. Apply `tag` to the whole book from the entry content field, assert the
 *     snackbar, the wrapped active entry, and the idempotent re-open.
 *  2. The ROADMAP cycle: wrap all → export World Info JSON → re-import →
 *     strip with `none` → export → the first entry's payload is byte-identical
 *     to the fixture content underneath its (replaced) pre-existing wrapper.
 *  3. A literal trailing `---` scene break survives a tag wrap/strip cycle
 *     untouched (the Phase-1 D4 destructive-strip regression guard).
 *  4. The checked-selection flow (Task 12 D2): the batch toolbar's Delimiters
 *     button opens the pane LOCKED to the selection (selection heading, no
 *     Apply-to combobox), applies with per-entry naming, and clears the
 *     selection — both checked entries carry their own-name wrappers, in the
 *     drawer toolbar (desktop) and in the bottom bar's batch strip (phone).
 *  5. A single-line mismatched `<foo>x</bar>` pair is classified (Task 05 U1):
 *     the dialog replaces it with one clean wrapper instead of nesting a
 *     second shell around it, and `none` then leaves the bare payload.
 *  6. A well-formed wrapper with a foreign name (`<TEAFsa>`) is detected
 *     regardless of its name: a re-wrap replaces it instead of nesting, and
 *     `none` strips it.
 *  7. A mismatched `<test> … </universe>` entry is flagged end to end (badge
 *     hint, code-button tooltip, dialog banner, row chip), the tag style
 *     repairs it into exactly one wrapper pair that survives export →
 *     re-import byte for byte, and `none` removes the broken pair keeping the
 *     payload intact.
 *  8. An orphan opener whose tag matches no entry name stays payload (hint
 *     gating): the wrap is additive and the prose is never truncated.
 *  9. The markdown style (Task 12): the level select and trailing-`---`
 *     toggle ride every apply (preview-is-what-is-written), re-apply at a
 *     level is a byte-fixed point, a level change normalizes in place (never
 *     `## ###`), and the wrapper survives export → re-import byte for byte.
 * 10. Broken markdown headers (Task 12): an empty `##` opener and a
 *     glue-typed `#Name` opener are classified (badge, banner, chip, row
 *     hint — the glue shape hint-gated on the entry name) and repair to one
 *     clean wrapper keeping the payload byte-identical.
 * 11. On a phone-sized viewport the pane opens as the `app-delimiters-sheet`
 *     bottom sheet at its documented 88dvh height AND Apply really
 *     transforms the content (the layout-only check in `ui-responsiveness`).
 * 12. On a phone-sized viewport the banner and repair flow work inside the
 *     bottom sheet.
 */


/** The original fixture, parsed once at module load (shared shape guard). */
const original = JSON.parse(readFileSync(FATE_PATH, 'utf8')) as {
  stlo: Record<string, unknown>;
  entries: Record<string, { content?: string; comment?: string }>;
};

/**
 * The fixture entry at a display-order index. `stNativeToCharacterBook`
 * sorts by `displayIndex` (falling back to `uid`); the lowest `displayIndex`
 * is the entry the studio shows first (uid `1`), so index 1 is the list's
 * second row — the selection tests' second target.
 */
function fixtureUidAt(index: number): string {
  const ids = Object.keys(original.entries);
  const keyed = ids.map((id) => {
    const entry = original.entries[id] as { displayIndex?: number; uid?: number };
    return { id, order: entry.displayIndex ?? entry.uid ?? Number.POSITIVE_INFINITY };
  });
  keyed.sort((a, b) => a.order - b.order);
  const at = keyed[index];
  assert(at, `the Fate fixture has no entry at display-order index ${index}`);
  return at.id;
}

/** The fixture's first entry in the editor's display order (uid `1`). */
const FIRST_UID = fixtureUidAt(0);

/** The fixture's second entry in display order — the selection tests' other target. */
const SECOND_UID = fixtureUidAt(1);

/** The entry's `comment` — its list title and its per-entry wrapper name. */
function fixtureComment(uid: string): string {
  return (original.entries[uid] as { comment?: string }).comment ?? '';
}

/**
 * The byte-exact content a tag apply must write for the fixture entry `uid`
 * under selection mode's per-entry naming: detection is name-agnostic, so
 * the entry's snake_case fixture shell is REPLACED (never nested) and the
 * payload sits verbatim under a wrapper named from the entry's comment.
 * Mirrors `entryDelimiterName` (comment, then name, then first key).
 */
function expectedSelectionWrap(uid: string): string {
  const entry = original.entries[uid] as { content?: string; comment?: string };
  const payload = unwrapTagWrapper(entry.content ?? '')?.inner;
  assert(payload, `fixture uid ${uid} content is not a tag wrapper`);
  return tagWrap(payload, sanitizeDelimiterName(entry.comment ?? ''));
}

/**
 * Mirror of `wrapContent(content, 'tag', name)` for a single wrapper: the
 * export must be exactly `<name>\n<original>\n</name>`. Keeping this inline
 * (rather than importing `src/`) pins the on-disk format independently of the
 * implementation under test.
 */
function tagWrap(content: string, name: string): string {
  return `<${name}>\n${content}\n</${name}>`;
}

/**
 * Payload of the seeded malformed entry; every repair/remove cycle must keep
 * it byte for byte.
 */
const MALFORMED_PAYLOAD = 'The Greater Grail grants three wishes.';

/** A mismatched whole-content pair: `<test>` opens, `</universe>` closes. */
const MALFORMED_CONTENT = `<test>\n${MALFORMED_PAYLOAD}\n</universe>`;

/**
 * The repaired content the dialog writes for the seeded entry: entry scope
 * resolves the wrapper name from the entry's comment ("New entry 0"), and the
 * broken pair is replaced — never nested.
 */
const REPAIRED_CONTENT = tagWrap(MALFORMED_PAYLOAD, 'New entry 0');

/** Mirrors `wrapContent`'s name sanitizer so export assertions match exactly. */
function sanitizeDelimiterName(name: string): string {
  const collapsed = (name ?? '')
    .replace(/[<>=[\]\n\r]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return [...collapsed].slice(0, 80).join('');
}

/**
 * Mirrors the core tag detection for a whole-content `<name>` wrapper:
 * returns the wrapper name and the payload underneath it, or null when the
 * content is not one. Every fixture entry arrives pre-wrapped this way
 * (snake_case shells like `<greater_grail>`), so the payload — not the whole
 * content — is what wrap/strip cycles must preserve. Inline (rather than
 * imported from `src/`) to pin the on-disk format independently.
 */
function unwrapTagWrapper(content: string): { name: string; inner: string } | null {
  const match = /^\s*<([^<>\n]{1,80})>\r?\n?([\s\S]*?)\r?\n?<\/\1>\s*$/.exec(content);
  return match ? { name: match[1] ?? '', inner: match[2] ?? '' } : null;
}

/**
 * Opens the delimiter dialog from the entry content field's suffix button.
 * The dialog is lazy-loaded, so wait for its title rather than racing the
 * dynamic import.
 */
async function openDelimiterDialog(page: Page): Promise<void> {
  await page.locator('[aria-label="Content delimiters"]').click();
  await expect(page.getByRole('heading', { name: 'Content delimiters' })).toBeVisible();
}

/** The delimiter dialog's overlay pane (there is exactly one at a time). */
function delimiterPane(page: Page): Locator {
  return page.locator('app-delimiter-dialog');
}

/** The dialog's two `mat-select`s: first scope, second style (per its markup). */
function scopeSelect(page: Page): Locator {
  return delimiterPane(page).getByRole('combobox', { name: 'Apply to' });
}

function styleSelect(page: Page): Locator {
  return delimiterPane(page).getByRole('combobox', { name: 'Delimiter style' });
}

/** The markdown style's heading-level select (rendered only for markdown). */
function levelSelect(page: Page): Locator {
  return delimiterPane(page).getByRole('combobox', { name: 'Heading level' });
}

/** The markdown style's trailing-`---` toggle (rendered only for markdown). */
function trailingSeparatorCheckbox(page: Page): Locator {
  return delimiterPane(page).getByRole('checkbox', { name: 'Add trailing ---' });
}

/** The delimiter pane's bottom-sheet overlay pane (phones, `.app-delimiters-sheet`). */
function delimiterSheetPane(page: Page): Locator {
  return page.locator('.cdk-overlay-pane.app-delimiters-sheet');
}

/** The entry tab strip's active tab (aria-selected — the public ARIA contract). */
function activeEntryTab(page: Page): Locator {
  return page.locator('app-entry-editor .entry-tabs [role="tab"][aria-selected="true"]');
}

/**
 * Mirror of `wrapContent`'s markdown arm (Task 12): the `#{level} name`
 * header, one structural blank line, the verbatim payload, and the toggle
 * marker when asked. Inline (rather than imported from `src/`) to pin the
 * emitted bytes independently of the implementation under test.
 */
function markdownWrap(
  payload: string,
  name: string,
  level = 2,
  trailingSeparator = false,
): string {
  return `${'#'.repeat(level)} ${name}\n\n${payload}${trailingSeparator ? '\n\n---' : ''}`;
}

/** Payload for the markdown apply/survival tests — bare prose, no delimiters. */
const MD_PAYLOAD = 'Plain prose body that markdown wrapping must keep verbatim.';

/** Empty ATX header content (Task 12): `##` alone on the first line, then the payload. */
const EMPTY_HEADER_CONTENT = `##\n\n${MALFORMED_PAYLOAD}`;

/** Glue-typed header matching the entry name (`#New entry 0`), then the payload. */
const NO_SPACE_HEADER_CONTENT = `#New entry 0\n${MALFORMED_PAYLOAD}`;

/** A glue-typed header matching NO entry name — the hint-gating negative. */
const FOREIGN_NO_SPACE_CONTENT = `#UnrelatedScene\n${MALFORMED_PAYLOAD}`;

/**
 * Picks an option from a Material select's overlay by visible label. The
 * dialog's selects are CVA components writing into the Signal Form model, so
 * the real overlay click is what the user does.
 */
async function pickSelectOption(
  page: Page,
  select: Locator,
  optionLabel: string | RegExp,
): Promise<void> {
  await select.click();
  await expect(page.getByRole('listbox')).toBeVisible();
  await page.getByRole('option', { name: optionLabel }).click();
  await expect(page.getByRole('listbox')).toBeHidden();
}

/** Reads the whole-book target count the preview header reports. */
async function readTargetCount(page: Page): Promise<number> {
  const header = delimiterPane(page).locator('.preview-header');
  await expect(header).toContainText(/\d+ of \d+ entr(y|ies) will change/);
  const meta = await header.locator('.meta').innerText();
  const match = /of\s+(\d+)\s+entr/i.exec(meta);
  assert(match, `no target count in the preview header: ${meta}`);
  const count = Number(match[1]);
  assert(Number.isFinite(count) && count > 0, `unusable target count: ${match[1]}`);
  return count;
}

/**
 * Reads the `changedCount` the preview header reports ("N of M … will change").
 */
async function readChangedCount(page: Page): Promise<number> {
  const meta = await delimiterPane(page).locator('.preview-header .meta').innerText();
  const match = /(\d+)\s+of\s+\d+\s+entr/i.exec(meta);
  assert(match, `no changed count in the preview header: ${meta}`);
  return Number(match[1]);
}

/** The dialog's Apply button (last action; label varies with scope). */
function applyButton(page: Page): Locator {
  return delimiterPane(page).getByRole('button', { name: /Apply/ });
}

/**
 * Applies the current dialog selection, waits for the dialog to close, and
 * returns the snackbar text. The snackbar auto-dismisses, so capture it while
 * visible instead of relying on a later snapshot.
 */
async function applyAndReadSnackbar(page: Page): Promise<string> {
  const snackbar = page.locator('.mat-mdc-snack-bar-label').last();
  await applyButton(page).click();
  await expect(delimiterPane(page)).toBeHidden();
  await expect(snackbar).toContainText('Delimiters updated on');
  return snackbar.innerText();
}

/** The native export's `entries` bag, typed for content lookups. */
function exportedEntries(json: Record<string, unknown>): Record<string, { content?: string }> {
  return (json['entries'] ?? {}) as Record<string, { content?: string }>;
}

/** Creates the delimiter suite's project through the shared welcome flow. */
async function createProject(page: Page): Promise<void> {
  await createProjectViaWelcomeScreen(page, 'E2E Delimiters');
}

/** Creates a project with one entry whose content is seeded to `content`. */
async function newProjectWithEntryContent(page: Page, content: string): Promise<void> {
  await createProject(page);
  await page.locator('app-entry-list [aria-label="New entry"]').click();
  await expect(page.locator('app-entry-editor .entry-tabs')).toBeVisible();
  await setEntryContent(page, content);
}

/** Creates a project with one entry whose content is the mismatched pair. */
async function newProjectWithMalformedEntry(page: Page): Promise<void> {
  return newProjectWithEntryContent(page, MALFORMED_CONTENT);
}

/**
 * Adds an entry on a compact viewport: opens the off-canvas entries drawer,
 * creates the entry (which opens its editor tab), then releases the drawer.
 */
async function addEntryOnPhone(page: Page): Promise<void> {
  const listAddButton = page.locator('app-entry-list [aria-label="New entry"]');
  if (!(await listAddButton.isVisible())) {
    await page.locator('[aria-label="Toggle entries panel"]').click();
  }
  await expect(listAddButton).toBeVisible();
  await listAddButton.click();
  await expect(page.locator('app-entry-editor .entry-tabs')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.entries-sidenav')).not.toBeInViewport();
  // See ui-responsiveness.spec.ts addEntry: the drawer's focus restore pans
  // the overflow:hidden workspace sideways; re-zero before asserting layout.
  await page.evaluate(() => {
    const workspace = document.querySelector('.workspace') as HTMLElement | null;
    if (workspace) {
      workspace.scrollLeft = 0;
    }
  });
  await expect(page.locator('[aria-label="Entry content"]')).toBeVisible();
}

test.describe('delimiters via the real dialog', () => {
  // Importing the Fate fixture and applying to all 70 entries is a long
  // interaction on the WebKit simulator; the default 30s budget expires
  // mid-suite even when every assertion is healthy.
  test.describe.configure({ timeout: 90_000 });
  test.use({ viewport: { width: 1920, height: 1080 } });
  // Project gate (plan §3.5.5): this describe pins a 1920px desktop viewport,
  // so the mobile projects would only replay the desktop flow under a phone
  // UA — the desktop project already covers it. The phone leg below runs on
  // the mobile projects (real device descriptors, both engines).
  test.skip(
    () => test.info().project.name.startsWith('mobile-'),
    'desktop-pinned delimiter flow runs on the desktop project only',
  );

  test('applies tag style to every entry and is idempotent on re-open', async ({ page }) => {
    await page.goto('/');
    await importLorebook(page, FATE_PATH);
    await openFirstEntry(page);
    await openDelimiterDialog(page);

    // Scope -> whole book; style stays Tag with per-entry naming on.
    await pickSelectOption(page, scopeSelect(page), /All entries/);
    const total = await readTargetCount(page);
    expect(total).toBe(70);
    expect(total).toBe(Object.keys(original.entries).length);

    // Every fixture entry arrives pre-wrapped under a snake_case name that
    // matches neither the comment nor the first key. Detection is
    // name-agnostic, so those shells are replaced rather than dual-wrapped —
    // every target still changes, and the total token estimate only grows.
    // Also pin the format example.
    expect(await readChangedCount(page)).toBe(total);
    const pane = delimiterPane(page);
    const nameInput = pane.locator('input[aria-label="Wrapper name"]');
    await expect(nameInput).toBeDisabled();

    const header = pane.locator('.preview-header');
    await expect(header).toContainText(new RegExp(`${total} of ${total} entr(y|ies) will change`));
    // Wrapping adds wrapper characters, so the estimate can only grow.
    const deltaText = await header.locator('.token-delta').innerText();
    expect(deltaText, 'wrapping must not report a negative token delta').not.toContain('−');
    expect(deltaText).toMatch(/~\+\d/);
    // The seeded fixed name (from the active entry) is shown while it still
    // applies; per-entry naming disables the field but the example reflects
    // the per-entry placeholder.
    await expect(pane.locator('.example-text')).toContainText('<entry name>');

    const snackbar = await applyAndReadSnackbar(page);
    expect(snackbar).toContain(`Delimiters updated on ${total} entries.`);

    // The active entry now starts with `<name>` and ends with its close tag.
    const firstName = sanitizeDelimiterName(
      (original.entries[FIRST_UID] as { comment?: string }).comment ?? '',
    );
    const content = await readEntryContent(page);
    expect(content.startsWith(`<${firstName}>`)).toBe(true);
    expect(content.endsWith(`</${firstName}>`)).toBe(true);
    // ... and the payload sits verbatim inside the new wrapper. The fixture's
    // own snake_case shell was replaced (not nested), so the body is the
    // original content minus that pre-existing wrapper.
    const payload = unwrapTagWrapper(original.entries[FIRST_UID]?.content ?? '')?.inner;
    assert(payload, 'fixture first entry content is not a tag wrapper');
    const body = content.slice(
      `<${firstName}>\n`.length,
      content.length - `\n</${firstName}>`.length,
    );
    expect(body).toBe(payload);

    // Re-open on the same entry: the wrap is a fixed point, Apply is disabled.
    await openDelimiterDialog(page);
    await expect(delimiterPane(page).locator('.preview-header')).toContainText(
      '0 of 1 entry will change',
    );
    expect(await readChangedCount(page)).toBe(0);
    await expect(applyButton(page)).toBeDisabled();
    await delimiterPane(page).getByRole('button', { name: 'Cancel' }).click();
  });

  test('wrap all -> export -> re-import -> strip -> export restores the payload', async ({
    page,
  }) => {
    const originalEntry = original.entries[FIRST_UID] as { content?: string; comment?: string };
    const originalContent = originalEntry.content;
    assert(originalContent, `fixture uid ${FIRST_UID} has no content`);
    const firstName = sanitizeDelimiterName(originalEntry.comment ?? '');
    // The fixture content itself is already tag-wrapped (`greater_grail`);
    // what wrap/strip cycles must preserve is the payload underneath.
    const payload = unwrapTagWrapper(originalContent)?.inner;
    assert(payload, `fixture uid ${FIRST_UID} content is not a tag wrapper`);

    await page.goto('/');
    await importLorebook(page, FATE_PATH);
    await openFirstEntry(page);
    await openDelimiterDialog(page);
    await pickSelectOption(page, scopeSelect(page), /All entries/);
    const total = await readTargetCount(page);
    await applyAndReadSnackbar(page);

    // First export: the active entry carries exactly the new wrapper around
    // the untouched payload — the pre-existing snake_case shell was replaced,
    // not nested into a dual-shell output.
    const wrapped = await exportWorldInfo(page);
    const firstExport = exportedEntries(wrapped.json)[FIRST_UID];
    assert(firstExport, `uid ${FIRST_UID} missing from the first export`);
    expect(firstExport.content).toBe(tagWrap(payload, firstName));

    // Re-import that export through the Projects menu (replaces the project).
    const reimportChooser = page.waitForEvent('filechooser');
    await page.locator('[aria-label="Projects menu"]').click();
    await page.getByText('Open lorebook or card').click();
    await (await reimportChooser).setFiles(await wrapped.download.path());
    await expect(page.locator('[aria-label="More actions menu"]')).toBeVisible();
    await expect(page.locator('.entries-sidenav')).toBeAttached();

    // Strip every wrapper with `none`, then export once more: the cycle must
    // restore the payload byte for byte (the replaced fixture shell is gone
    // by design — wrap swaps shells, strip removes the current one).
    await openFirstEntry(page);
    await openDelimiterDialog(page);
    await pickSelectOption(page, scopeSelect(page), /All entries/);
    await pickSelectOption(page, styleSelect(page), /None/);
    expect(await readChangedCount(page)).toBe(total);
    await applyAndReadSnackbar(page);

    const stripped = await exportWorldInfo(page);
    const secondExport = exportedEntries(stripped.json)[FIRST_UID];
    assert(secondExport, `uid ${FIRST_UID} missing from the second export`);
    expect(secondExport.content).toBe(payload);
  });

  test('a literal trailing --- scene break survives a tag wrap/strip cycle', async ({ page }) => {
    await createProject(page);
    // A single entry on desktop is added straight from the sidebar/topbar.
    const listAddButton = page.locator('app-entry-list [aria-label="New entry"]');
    await listAddButton.click();
    await expect(page.locator('app-entry-editor .entry-tabs')).toBeVisible();

    const body = 'The scene fades to black.\n\n---';
    await setEntryContent(page, body);

    // Wrap with tag style (entry scope), then strip with none.
    await openDelimiterDialog(page);
    const changedBefore = await readChangedCount(page);
    expect(changedBefore).toBe(1);
    await applyAndReadSnackbar(page);
    const wrapped = await readEntryContent(page);
    expect(wrapped).toContain(body);
    expect(wrapped.endsWith('</New entry 0>')).toBe(true);

    await openDelimiterDialog(page);
    await pickSelectOption(page, styleSelect(page), /None/);
    expect(await readChangedCount(page)).toBe(1);
    await applyAndReadSnackbar(page);

    // The scene-break `---` must be back, byte for byte — the D4 guard.
    expect(await readEntryContent(page)).toBe(body);
  });

  test('a single-line mismatched <foo>x</bar> pair is replaced without nesting', async ({
    page,
  }) => {
    await createProject(page);
    await page.locator('app-entry-list [aria-label="New entry"]').click();
    await expect(page.locator('app-entry-editor .entry-tabs')).toBeVisible();

    // Regression pin for Task 05 (U1): the dialog used to treat the broken
    // pair as payload and bake a second wrapper around it. It now classifies
    // the single-line mismatched pair too (structural newlines are optional)
    // and replaces it with exactly one clean shell.
    const malformed = '<foo>x</bar>';
    await setEntryContent(page, malformed);

    await openDelimiterDialog(page);
    // The entry scope's fixed name is derived from the entry's comment.
    await expect(delimiterPane(page).locator('input[aria-label="Wrapper name"]')).toHaveValue(
      'New entry 0',
    );
    await expect(delimiterPane(page).locator('.row-chip.malformed-chip')).toHaveText('mismatched');
    await expect(delimiterPane(page).locator('.row-hint')).toHaveText(
      'Will replace the mismatched <foo> and </bar> delimiters',
    );
    await applyAndReadSnackbar(page);
    expect(await readEntryContent(page)).toBe(tagWrap('x', 'New entry 0'));

    // `none` then strips the replacement back to the bare payload.
    await openDelimiterDialog(page);
    await pickSelectOption(page, styleSelect(page), /None/);
    await applyAndReadSnackbar(page);
    expect(await readEntryContent(page)).toBe('x');
  });

  test('an orphan opener matching no entry name stays payload and wraps additively', async ({
    page,
  }) => {
    await createProject(page);
    await page.locator('app-entry-list [aria-label="New entry"]').click();
    await expect(page.locator('app-entry-editor .entry-tabs')).toBeVisible();

    // Hint gating (§3.2.4): a lone `<div>` opener matches neither the entry's
    // comment nor its keys, so it classifies as payload — the wrap is
    // additive and the prose is never truncated (the D4 guard, now pinned for
    // the orphan family too).
    const prose = '<div>\nAn orphaned code sample that must survive verbatim.';
    await setEntryContent(page, prose);
    await expect(page.locator('.malformed-hint')).toHaveCount(0);

    await openDelimiterDialog(page);
    await expect(delimiterPane(page).locator('.malformed-banner')).toHaveCount(0);
    await expect(delimiterPane(page).locator('.row-chip.malformed-chip')).toHaveCount(0);
    await expect(delimiterPane(page).locator('.row-hint')).toHaveCount(0);
    await applyAndReadSnackbar(page);
    expect(await readEntryContent(page)).toBe(tagWrap(prose, 'New entry 0'));
  });

  test('a mismatched pair is flagged by the badge hint, tooltip, banner, and row chip', async ({
    page,
  }) => {
    await newProjectWithMalformedEntry(page);

    // The entry badge is no longer blind: the hint names the broken shell.
    await expect(page.locator('.malformed-hint')).toHaveText(
      '<test> ? </universe> · click the code button to fix',
    );
    // ...and the code button's tooltip says what to do about it.
    await page.locator('[aria-label="Content delimiters"]').hover();
    const tooltip = page.locator('.mat-mdc-tooltip-panel');
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText(
      'Content has mismatched or unclosed delimiters — click to fix',
    );

    await openDelimiterDialog(page);

    // The error banner sits above the preview header with the singular count.
    const banner = delimiterPane(page).locator('.malformed-banner');
    await expect(banner).toBeVisible();
    await expect(banner.locator('.banner-title')).toHaveText('1 entry has malformed delimiters');
    await expect(banner.locator('.banner-body')).toContainText('<test> … </universe>');
    await expect(banner.locator('.banner-body')).toContainText(
      'Applying a style replaces them; None removes them.',
    );
    // The meta line counts the malformed targets ...
    await expect(delimiterPane(page).locator('.preview-header .meta')).toContainText(
      '· 1 malformed',
    );
    // ... and the row carries the tonal chip plus the exact-repair hint.
    await expect(delimiterPane(page).locator('.row-chip.malformed-chip')).toHaveText('mismatched');
    await expect(delimiterPane(page).locator('.row-hint')).toHaveText(
      'Will replace the mismatched <test> and </universe> delimiters',
    );
    expect(await readChangedCount(page)).toBe(1);
  });

  test('applying the tag style repairs the pair into exactly one clean wrapper', async ({
    page,
  }) => {
    await newProjectWithMalformedEntry(page);
    await openDelimiterDialog(page);

    const snackbar = await applyAndReadSnackbar(page);
    expect(snackbar).toContain('Delimiters updated on 1 entry.');

    // Exactly one wrapper pair on screen: the new shell around the verbatim
    // payload — no `<test>`/`</universe>` remnants, no nesting.
    const content = await readEntryContent(page);
    expect(content).toBe(REPAIRED_CONTENT);
    expect((content.match(/<New entry 0>/g) ?? []).length).toBe(1);
    expect((content.match(/<\/New entry 0>/g) ?? []).length).toBe(1);
    expect(content).not.toContain('<test>');
    expect(content).not.toContain('</universe>');

    // The badge hint flips to the well-formed wrapper label.
    await expect(page.locator('.malformed-hint')).toHaveCount(0);
    await expect(page.getByText('<New entry 0> · click the code button to change')).toBeVisible();

    // Re-open on the repaired entry: a fixed point, no banner, Apply disabled.
    await openDelimiterDialog(page);
    await expect(delimiterPane(page).locator('.malformed-banner')).toHaveCount(0);
    await expect(delimiterPane(page).locator('.preview-header')).toContainText(
      '0 of 1 entry will change',
    );
    await expect(delimiterPane(page).locator('.preview-header .meta')).not.toContainText(
      'malformed',
    );
    await expect(applyButton(page)).toBeDisabled();
    await delimiterPane(page).getByRole('button', { name: 'Cancel' }).click();
  });

  test('the repaired wrapper survives export and re-import byte for byte', async ({ page }) => {
    await newProjectWithMalformedEntry(page);
    await openDelimiterDialog(page);
    await applyAndReadSnackbar(page);

    // Export: exactly one entry carries the single clean wrapper pair.
    const exported = await exportWorldInfo(page);
    const wrapped = Object.values(exportedEntries(exported.json)).filter(
      (entry) => entry.content === REPAIRED_CONTENT,
    );
    expect(wrapped, 'exactly one entry exports the repaired content').toHaveLength(1);
    const exportedContent = wrapped[0]?.content ?? '';
    expect((exportedContent.match(/<New entry 0>/g) ?? []).length).toBe(1);
    expect((exportedContent.match(/<\/New entry 0>/g) ?? []).length).toBe(1);
    expect(exportedContent).not.toContain('<test>');
    expect(exportedContent).not.toContain('</universe>');

    // Re-import that export through the Projects menu (replaces the project).
    const reimportChooser = page.waitForEvent('filechooser');
    await page.locator('[aria-label="Projects menu"]').click();
    await page.getByText('Open lorebook or card').click();
    await (await reimportChooser).setFiles(await exported.download.path());
    await expect(page.locator('[aria-label="More actions menu"]')).toBeVisible();
    await expect(page.locator('.entries-sidenav')).toBeAttached();

    await openFirstEntry(page);
    await expect(page.locator('[aria-label="Entry content"]')).toHaveValue(REPAIRED_CONTENT);
    // The imported entry is well-formed: wrapper badge, no malformed hint.
    await expect(page.locator('.malformed-hint')).toHaveCount(0);
    await expect(page.getByText('<New entry 0> · click the code button to change')).toBeVisible();
  });

  test('the None style removes the broken pair and keeps the payload byte for byte', async ({
    page,
  }) => {
    await newProjectWithMalformedEntry(page);
    await openDelimiterDialog(page);
    await pickSelectOption(page, styleSelect(page), /None/);

    // The banner and chip persist; the hint now says the pair is removed.
    await expect(delimiterPane(page).locator('.malformed-banner')).toBeVisible();
    await expect(delimiterPane(page).locator('.row-chip.malformed-chip')).toHaveText('mismatched');
    await expect(delimiterPane(page).locator('.row-hint')).toHaveText(
      'Will remove the mismatched <test> and </universe> delimiters',
    );
    expect(await readChangedCount(page)).toBe(1);

    const snackbar = await applyAndReadSnackbar(page);
    expect(snackbar).toContain('Delimiters updated on 1 entry.');

    // Broken tags gone, payload byte-identical, no wrapper of any kind.
    expect(await readEntryContent(page)).toBe(MALFORMED_PAYLOAD);

    // Neither badge hint renders for bare payload.
    await expect(page.locator('.malformed-hint')).toHaveCount(0);
    await expect(page.locator('app-entry-content-field mat-hint:not(.stats-hint)')).toHaveCount(0);
  });

  test('a foreign-named wrapper is replaced on re-wrap and stripped by none', async ({ page }) => {
    await createProject(page);
    await page.locator('app-entry-list [aria-label="New entry"]').click();
    await expect(page.locator('app-entry-editor .entry-tabs')).toBeVisible();

    // Regression: detection used to require the wrapper name to match the
    // resolved wrapper name, so a well-formed `<TEAFsa>` shell was dual-wrapped
    // on apply and survived `none` untouched.
    const body = 'Greater Grail body stays verbatim.';
    await setEntryContent(page, `<TEAFsa>\n${body}\n</TEAFsa>`);

    await openDelimiterDialog(page);
    // The resolved wrapper name comes from the entry's comment, not the tag —
    // detection must still report the existing wrapper.
    await expect(
      delimiterPane(page).locator('input[aria-label="Wrapper name"]'),
    ).toHaveValue('New entry 0');
    await expect(delimiterPane(page).locator('.row-hint')).toContainText(
      'Will replace the existing <TEAFsa> delimiter',
    );
    await applyAndReadSnackbar(page);
    expect(await readEntryContent(page)).toBe(tagWrap(body, 'New entry 0'));

    // And `none` strips the replacement back to the bare payload.
    await openDelimiterDialog(page);
    await pickSelectOption(page, styleSelect(page), /None/);
    await expect(delimiterPane(page).locator('.row-hint')).toContainText(
      'Will remove the existing <New entry 0> delimiter',
    );
    await applyAndReadSnackbar(page);
    expect(await readEntryContent(page)).toBe(body);
  });

  test('applies tag to the checked selection from the batch toolbar and clears it', async ({
    page,
  }) => {
    await page.goto('/');
    await importLorebook(page, FATE_PATH);
    await selectFirstTwoRows(page);
    await page.locator('[aria-label="Apply delimiters to selection"]').click();

    // Locked pane (Task 12 D2): the selection heading with NO Apply-to
    // combobox and no editor-scope discoverability hint.
    await expect(
      delimiterPane(page).getByRole('heading', { name: 'Delimiters — 2 entries' }),
    ).toBeVisible();
    await expect(scopeSelect(page)).toHaveCount(0);
    await expect(delimiterPane(page).locator('.scope-hint')).toHaveCount(0);
    await expect(delimiterPane(page).locator('.preview-header')).toContainText(
      '2 of 2 entries will change',
    );

    const snackbar = await applyAndReadSnackbar(page);
    expect(snackbar).toContain('Delimiters updated on 2 entries.');
    await expectSnackbar(page, 'Delimiters updated on 2 entries.');

    // A truthy pane result clears the selection: the batch toolbar goes away.
    await expect(page.getByRole('toolbar', { name: 'Batch actions' })).toBeHidden();

    // Each checked entry carries its own-name wrapper around the verbatim
    // payload — the fixture's snake_case shell replaced, never nested.
    for (const [index, uid] of [
      [0, FIRST_UID],
      [1, SECOND_UID],
    ] as const) {
      await openEntryRow(page, index);
      await expect(activeEntryTab(page)).toContainText(fixtureComment(uid));
      expect(await readEntryContent(page)).toBe(expectedSelectionWrap(uid));
    }
  });

  test('markdown style is idempotent, normalizes the level, and toggles the trailing ---', async ({
    page,
  }) => {
    await createProject(page);
    await page.locator('app-entry-list [aria-label="New entry"]').click();
    await expect(page.locator('app-entry-editor .entry-tabs')).toBeVisible();
    await setEntryContent(page, MD_PAYLOAD);

    // Default level 2: the wrap is `## New entry 0`, one blank line, payload.
    await openDelimiterDialog(page);
    await pickSelectOption(page, styleSelect(page), /Markdown/);
    await expect(delimiterPane(page).locator('.example-text')).toContainText('## New entry 0');
    await applyAndReadSnackbar(page);
    expect(await readEntryContent(page)).toBe(markdownWrap(MD_PAYLOAD, 'New entry 0'));
    // Checkpoint 12-1 pin: `##`-led content classifies as the markdown style.
    await expect(page.getByText('## New entry 0 · click the code button to change')).toBeVisible();

    // Re-open and re-apply at the same level: a byte-fixed point.
    await openDelimiterDialog(page);
    await pickSelectOption(page, styleSelect(page), /Markdown/);
    expect(await readChangedCount(page)).toBe(0);
    await expect(applyButton(page)).toBeDisabled();
    await delimiterPane(page).getByRole('button', { name: 'Cancel' }).click();

    // A level change normalizes in place — never nests `## ###` or `### ##`.
    await openDelimiterDialog(page);
    await pickSelectOption(page, styleSelect(page), /Markdown/);
    await pickSelectOption(page, levelSelect(page), /^### — H3$/);
    await expect(delimiterPane(page).locator('.example-text')).toContainText('### New entry 0');
    expect(await readChangedCount(page)).toBe(1);
    await applyAndReadSnackbar(page);
    expect(await readEntryContent(page)).toBe(markdownWrap(MD_PAYLOAD, 'New entry 0', 3));

    // Toggle "Add trailing ---" on: exactly one canonical marker appended.
    await openDelimiterDialog(page);
    await pickSelectOption(page, styleSelect(page), /Markdown/);
    await pickSelectOption(page, levelSelect(page), /^### — H3$/);
    await trailingSeparatorCheckbox(page).click();
    await expect(delimiterPane(page).locator('.example-text')).toContainText('---');
    await applyAndReadSnackbar(page);
    expect(await readEntryContent(page)).toBe(markdownWrap(MD_PAYLOAD, 'New entry 0', 3, true));

    // Toggle off (a fresh dialog defaults to off): the marker is removed again.
    await openDelimiterDialog(page);
    await pickSelectOption(page, styleSelect(page), /Markdown/);
    await pickSelectOption(page, levelSelect(page), /^### — H3$/);
    await applyAndReadSnackbar(page);
    expect(await readEntryContent(page)).toBe(markdownWrap(MD_PAYLOAD, 'New entry 0', 3));
  });

  test('the markdown wrapper survives export and re-import byte for byte', async ({ page }) => {
    await createProject(page);
    await page.locator('app-entry-list [aria-label="New entry"]').click();
    await expect(page.locator('app-entry-editor .entry-tabs')).toBeVisible();
    await setEntryContent(page, MD_PAYLOAD);

    await openDelimiterDialog(page);
    await pickSelectOption(page, styleSelect(page), /Markdown/);
    await applyAndReadSnackbar(page);
    const wrapped = markdownWrap(MD_PAYLOAD, 'New entry 0');

    const exported = await exportWorldInfo(page);
    const contents = Object.values(exportedEntries(exported.json)).map(
      (entry) => entry.content ?? '',
    );
    expect(contents.filter((content) => content === wrapped)).toHaveLength(1);

    // Re-import that export through the Projects menu (replaces the project):
    // the header must arrive byte-identical and still classify as markdown.
    await importViaProjectsMenu(page, await exported.download.path());
    await openFirstEntry(page);
    expect(await readEntryContent(page)).toBe(wrapped);
    await expect(page.locator('.malformed-hint')).toHaveCount(0);
    await expect(page.getByText('## New entry 0 · click the code button to change')).toBeVisible();
  });

  test('an empty ## header is flagged and repaired keeping the payload byte-identical', async ({
    page,
  }) => {
    await newProjectWithEntryContent(page, EMPTY_HEADER_CONTENT);

    // The badge names the broken shell (un-hinted classification).
    await expect(page.locator('.malformed-hint')).toHaveText(
      '## ? · click the code button to fix',
    );

    await openDelimiterDialog(page);
    const pane = delimiterPane(page);
    const banner = pane.locator('.malformed-banner');
    await expect(banner).toBeVisible();
    await expect(banner.locator('.banner-body')).toContainText('broken ATX heading');
    await expect(pane.locator('.row-chip.malformed-chip')).toHaveText('empty header');
    await expect(pane.locator('.row-hint')).toHaveText(
      'Will replace the empty ## heading (no header text)',
    );
    expect(await readChangedCount(page)).toBe(1);

    // The tag repair strips the broken first line: the payload survives byte
    // for byte under the one clean wrapper.
    await applyAndReadSnackbar(page);
    expect(await readEntryContent(page)).toBe(REPAIRED_CONTENT);
    await expect(page.locator('.malformed-hint')).toHaveCount(0);
  });

  test('a glue-typed header is hint-gated on the entry name and repairs to one wrapper', async ({
    page,
  }) => {
    await newProjectWithEntryContent(page, FOREIGN_NO_SPACE_CONTENT);

    // Hint gating (§3.2.4): `#UnrelatedScene` matches neither the entry's
    // comment nor its keys, so the glue shape stays payload — no badge.
    await expect(page.locator('.malformed-hint')).toHaveCount(0);

    // The matching-name spelling classifies: badge, banner, chip, row hint.
    await setEntryContent(page, NO_SPACE_HEADER_CONTENT);
    await expect(page.locator('.malformed-hint')).toHaveText(
      '#New entry 0 ? · click the code button to fix',
    );

    await openDelimiterDialog(page);
    const pane = delimiterPane(page);
    await expect(pane.locator('.malformed-banner')).toBeVisible();
    await expect(pane.locator('.row-chip.malformed-chip')).toHaveText('missing space');
    await expect(pane.locator('.row-hint')).toHaveText(
      'Will replace the unspaced #New entry 0 heading',
    );

    await applyAndReadSnackbar(page);
    expect(await readEntryContent(page)).toBe(REPAIRED_CONTENT);
    await expect(page.locator('.malformed-hint')).toHaveCount(0);
  });
});

test.describe('delimiters mobile viewport (390x844)', () => {
  // Phone-sized viewport with touch: the pane opens as the `app-delimiters-sheet`
  // bottom sheet through ResponsiveOverlayService (Task 12 §5.1, D3 — the
  // former compact full-screen dialog), the container stretches to the
  // documented 88dvh recipe (styles.scss), and Apply must actually perform
  // the transformation. The default 30s budget is tight for a cold WebKit run
  // (app boot + drawer choreography).
  test.describe.configure({ timeout: 75_000 });
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
  // Project gate (plan §3.5.5): a phone leg by design — mobile-chrome runs
  // the identical engine with a real device descriptor, so the desktop
  // project would only duplicate it.
  test.skip(
    () => test.info().project.name === 'desktop-chrome',
    'phone-pinned delimiter flow runs on the mobile projects only',
  );

  test('bottom sheet at 88dvh and Apply wraps the entry content', async ({ page }) => {
    await createProject(page);
    await addEntryOnPhone(page);
    await setEntryContent(page, 'Mobile delimiter body line.');

    await openDelimiterDialog(page);
    const pane = delimiterSheetPane(page);
    await expect(pane).toBeVisible();

    // The documented sheet container: fixed 88dvh height, full width, docked
    // to the viewport's bottom edge (>= 0.85 keeps a margin for rounding).
    const container = pane.locator('.mat-bottom-sheet-container');
    await expect(container).toBeVisible();
    const box = await container.boundingBox();
    assert(box, 'sheet container has no bounding box');
    const viewport = page.viewportSize();
    assert(viewport, 'page has no viewport size');
    expect(box.width).toBeGreaterThanOrEqual(viewport.width - 1);
    expect(box.height).toBeGreaterThanOrEqual(viewport.height * 0.85);

    // The diff body keeps its height instead of being squeezed to its toolbar.
    const diffBody = pane.locator('app-diff-viewer .diff-body');
    await expect(diffBody).toBeVisible();

    // Entry scope, tag style: applying wraps the single entry.
    const resolvedName = sanitizeDelimiterName(
      await pane.locator('input[aria-label="Wrapper name"]').inputValue(),
    );
    await expect(applyButton(page)).toBeInViewport();
    const snackbar = await applyAndReadSnackbar(page);
    expect(snackbar).toContain('Delimiters updated on 1 entry.');

    expect(await readEntryContent(page)).toBe(tagWrap('Mobile delimiter body line.', resolvedName));
  });

  test('malformed banner and repair flow work in the bottom sheet', async ({ page }) => {
    await createProject(page);
    await addEntryOnPhone(page);
    await setEntryContent(page, MALFORMED_CONTENT);

    // The badge flags the broken pair before any dialog is opened.
    await expect(page.locator('.malformed-hint')).toHaveText(
      '<test> ? </universe> · click the code button to fix',
    );

    await openDelimiterDialog(page);
    const pane = delimiterSheetPane(page);
    await expect(pane).toBeVisible();

    // Banner and mismatched chip inside the sheet pane.
    const banner = pane.locator('.malformed-banner');
    await expect(banner).toBeVisible();
    await expect(banner.locator('.banner-title')).toHaveText('1 entry has malformed delimiters');
    await expect(pane.locator('.row-chip.malformed-chip')).toHaveText('mismatched');
    await expect(pane.locator('.row-hint')).toHaveText(
      'Will replace the mismatched <test> and </universe> delimiters',
    );

    // Entry scope, tag style: Apply repairs the pair into one clean wrapper.
    const resolvedName = sanitizeDelimiterName(
      await pane.locator('input[aria-label="Wrapper name"]').inputValue(),
    );
    await expect(applyButton(page)).toBeInViewport();
    const snackbar = await applyAndReadSnackbar(page);
    expect(snackbar).toContain('Delimiters updated on 1 entry.');
    expect(await readEntryContent(page)).toBe(tagWrap(MALFORMED_PAYLOAD, resolvedName));
  });
});

test.describe('delimiters from the mobile bottom bar', () => {
  // Task 12 §5.2's phone entry point: the bottom bar's batch strip routes the
  // Delimiters item to EntryList.openDelimiters — the same locked pane as the
  // desktop toolbar, as a bottom sheet on the docked bar. Phone-pinned (the
  // strip only exists below the shell's 768px breakpoint).
  test.describe.configure({ timeout: 75_000 });
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
  test.skip(
    () => test.info().project.name === 'desktop-chrome',
    'phone-pinned delimiter flow runs on the mobile projects only',
  );

  test('the batch strip opens the locked sheet, applies, and clears the selection', async ({
    page,
  }) => {
    await page.goto('/');
    await importLorebook(page, FATE_PATH);
    await selectFirstTwoRows(page);

    // The strip is FOREGROUND while the drawer is open (the two are
    // spatially disjoint — no veil, no inert): tap Delimiters directly.
    // Closing the drawer first would collapse the strip — `App.barState`
    // keeps the swap only while the drawer shows a live selection.
    await page
      .locator('app-mobile-bottom-bar [aria-label="Apply delimiters to selection"]')
      .click();
    const pane = delimiterSheetPane(page);
    await expect(pane).toBeVisible();

    // Locked pane: the selection heading, no Apply-to combobox.
    await expect(
      pane.getByRole('heading', { name: 'Delimiters — 2 entries' }),
    ).toBeVisible();
    await expect(pane.getByRole('combobox', { name: 'Apply to' })).toHaveCount(0);
    await expect(pane.locator('.preview-header')).toContainText('2 of 2 entries will change');

    const snackbar = await applyAndReadSnackbar(page);
    expect(snackbar).toContain('Delimiters updated on 2 entries.');
    await expectSnackbar(page, 'Delimiters updated on 2 entries.');

    // The selection cleared, so the strip is gone (the drawer is still open —
    // the bar is backgrounded until a user closes it, as in Task 06).
    await expect(page.getByRole('toolbar', { name: 'Batch actions' })).toBeHidden();

    // Close the drawer: with no selection the bar returns to quick actions.
    await page.locator('[aria-label="Toggle entries panel"]').click();
    await expect(
      page.locator('app-mobile-bottom-bar nav[aria-label="Quick actions"]'),
    ).toBeVisible();

    // Each checked entry carries its own-name tag wrapper byte for byte.
    for (const [index, uid] of [
      [0, FIRST_UID],
      [1, SECOND_UID],
    ] as const) {
      await openEntryRow(page, index);
      await expect(activeEntryTab(page)).toContainText(fixtureComment(uid));
      expect(await readEntryContent(page)).toBe(expectedSelectionWrap(uid));
    }
  });
});
