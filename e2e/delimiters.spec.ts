import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Download, type Locator, type Page, test } from '@playwright/test';

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
 *  4. On a phone-sized viewport the dialog is full-screen AND Apply really
 *     transforms the content (the layout-only check in `ui-responsiveness`).
 *  5. A mismatched `<foo>x</bar>` is wrapped additively and never truncated,
 *     then survives `none` because it is not a well-formed wrapper.
 *  6. A well-formed wrapper with a foreign name (`<TEAFsa>`) is detected
 *     regardless of its name: a re-wrap replaces it instead of nesting, and
 *     `none` strips it.
 */

const FATE_PATH = join(process.cwd(), 'example_card', 'Fate Stay Night - Fuyuki Lorebook(1).json');

/** The original fixture, parsed once at module load (shared shape guard). */
const original = JSON.parse(readFileSync(FATE_PATH, 'utf8')) as {
  stlo: Record<string, unknown>;
  entries: Record<string, { content?: string; comment?: string }>;
};

/**
 * The fixture's first entry in the editor's display order. `stNativeToCharacterBook`
 * sorts by `displayIndex` (falling back to `uid`), and the editor opens the
 * first three sorted entries as tabs; the lowest `displayIndex` is the entry
 * the studio shows first. Empirically that is uid `1`.
 */
const FIRST_UID = (() => {
  const ids = Object.keys(original.entries);
  const keyed = ids.map((id) => {
    const entry = original.entries[id] as { displayIndex?: number; uid?: number };
    return { id, order: entry.displayIndex ?? entry.uid ?? Number.POSITIVE_INFINITY };
  });
  keyed.sort((a, b) => a.order - b.order);
  const first = keyed[0];
  assert(first, 'the Fate fixture has no entries');
  return first.id;
})();

/**
 * Mirror of `wrapContent(content, 'tag', name)` for a single wrapper: the
 * export must be exactly `<name>\n<original>\n</name>`. Keeping this inline
 * (rather than importing `src/`) pins the on-disk format independently of the
 * implementation under test.
 */
function tagWrap(content: string, name: string): string {
  return `<${name}>\n${content}\n</${name}>`;
}

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

/** Imports a lorebook file through the welcome screen, replacing the project. */
async function importLorebook(page: Page, path: string): Promise<void> {
  const importChooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import .json / .stproj' }).click();
  await (await importChooser).setFiles(path);
  // Assert the project-open top bar, not merely an attached sidenav: the
  // welcome state also renders a sidenav, so a silently failed import would
  // otherwise slip through and every later editor interaction would time out.
  await expect(page.locator('[aria-label="More actions menu"]')).toBeVisible();
  await expect(page.locator('.entries-sidenav')).toBeAttached();
}

/** Opens the first visible entry (its tab becomes the active editor pane). */
async function openFirstEntry(page: Page): Promise<void> {
  await page.locator('.entry-item').first().click();
  await expect(page.locator('app-entry-editor .entry-tabs')).toBeVisible();
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

/** Set the entry content via the form-field textarea (input event fires). */
async function setEntryContent(page: Page, content: string): Promise<void> {
  const textarea = page.locator('[aria-label="Entry content"]');
  await textarea.fill(content);
  await expect(textarea).toHaveValue(content);
}

/** Reads the active entry content textarea's current value. */
async function readEntryContent(page: Page): Promise<string> {
  return page.locator('[aria-label="Entry content"]').inputValue();
}

/** Exports via the top bar menu; resolves with the parsed JSON and its file. */
async function exportWorldInfo(
  page: Page,
): Promise<{ json: Record<string, unknown>; download: Download }> {
  await page.locator('[aria-label="Export menu"]').click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByText('World Info JSON').first().click(),
  ]);
  const json = JSON.parse(readFileSync(await download.path(), 'utf8')) as Record<string, unknown>;
  return { json, download };
}

/** The native export's `entries` bag, typed for content lookups. */
function exportedEntries(json: Record<string, unknown>): Record<string, { content?: string }> {
  return (json['entries'] ?? {}) as Record<string, { content?: string }>;
}

/** Creates a project through the welcome screen so the studio shell appears. */
async function createProject(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel('Project title').fill('E2E Delimiters');
  await page.getByRole('button', { name: 'Create Project' }).click();
  await expect(page.locator('[aria-label="More actions menu"]')).toBeVisible();
  await expect(page.locator('.entries-sidenav')).toBeAttached();
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
  await expect(page.locator('[aria-label="Entry content"]')).toBeVisible();
}

test.describe('delimiters via the real dialog', () => {
  // Importing the Fate fixture and applying to all 70 entries is a long
  // interaction on the WebKit simulator; the default 30s budget expires
  // mid-suite even when every assertion is healthy.
  test.describe.configure({ timeout: 90_000 });
  test.use({ viewport: { width: 1920, height: 1080 } });

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
    await page.getByText('Open .json / .stproj').click();
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

  test('a mismatched <foo>x</bar> is wrapped verbatim and never truncated', async ({ page }) => {
    await createProject(page);
    await page.locator('app-entry-list [aria-label="New entry"]').click();
    await expect(page.locator('app-entry-editor .entry-tabs')).toBeVisible();

    const malformed = '<foo>x</bar>';
    await setEntryContent(page, malformed);

    // Wrap with tag style: the malformed markup is undetected, so the new
    // wrapper is added around it without touching the inner bytes. The entry
    // scope's fixed name is derived from the entry's comment ("New entry 0").
    await openDelimiterDialog(page);
    const resolvedName = 'New entry 0';
    await expect(delimiterPane(page).locator('input[aria-label="Wrapper name"]')).toHaveValue(
      resolvedName,
    );
    await applyAndReadSnackbar(page);
    expect(await readEntryContent(page)).toBe(tagWrap(malformed, resolvedName));

    // `none` must not delete it either: the malformed markup is not a valid
    // tag pair, so there is nothing recognized to strip.
    await openDelimiterDialog(page);
    await pickSelectOption(page, styleSelect(page), /None/);
    expect(await readChangedCount(page)).toBe(1);
    await applyAndReadSnackbar(page);
    expect(await readEntryContent(page)).toBe(malformed);
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
});

test.describe('delimiters mobile viewport (390x844)', () => {
  // Phone-sized viewport with touch: the dialog must be a full-screen pane at
  // this breakpoint (the global `.app-compact-fullscreen-dialog` rules), and
  // Apply must actually perform the transformation. The default 30s budget is
  // tight for a cold WebKit run (app boot + drawer choreography).
  test.describe.configure({ timeout: 75_000 });
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('full-screen dialog and Apply wraps the entry content', async ({ page }) => {
    await createProject(page);
    await addEntryOnPhone(page);
    await setEntryContent(page, 'Mobile delimiter body line.');

    await openDelimiterDialog(page);
    const pane = page.locator('.cdk-overlay-pane.app-compact-fullscreen-dialog');
    await expect(pane).toBeVisible();

    // Edge-to-edge: the pane fills the viewport at this width.
    const box = await pane.boundingBox();
    assert(box, 'dialog pane has no bounding box');
    const viewport = page.viewportSize();
    assert(viewport, 'page has no viewport size');
    expect(box.width).toBeGreaterThanOrEqual(viewport.width - 1);
    expect(box.height).toBeGreaterThanOrEqual(viewport.height - 1);

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
});
