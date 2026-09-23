import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  activeEditorPane,
  buildNonCardPng,
  cardExportRow,
  compareCardPngBytes,
  EXAMPLE_CARD_JSON,
  EXAMPLE_CARD_PNG,
  exportCard,
  expectSnackbar,
  FATE_PATH,
  importLorebook,
  importViaProjectsMenu,
  openExportMenu,
  openFirstEntry,
  setEntryContent,
} from './helpers';

/**
 * Character-card round trip (plan 15 §3.6, E2E row): the user-provided
 * fixtures (`example_card/example_card.{png,json}`) open, edit, export and
 * re-import through the real studio UI on every project viewport (the mobile
 * projects exercise the bottom-bar Export menu, the desktop one the topbar).
 *
 * Byte fidelity (plan 15 §3.1): the PNG export re-embeds both card chunks in
 * place; every other byte — signature, IHDR, all IDATs, the foreign `deBG`
 * chunk, IEND, trailing bytes — must survive identically. The card JSON
 * export is field-faithful, NOT byte-identical (minified re-serialization +
 * pipeline-assigned entry ids) — only field pins there.
 */

interface CardFixture {
  readonly spec: string;
  readonly spec_version?: string;
  readonly data: {
    readonly name?: string;
    readonly description?: string;
    readonly character_book?: { readonly entries?: unknown };
  } & Record<string, unknown>;
}

type CardEntryFixture = Record<string, unknown> & { readonly content?: string };

/** The fixtures' character (data.name) — the project title and export names. */
const CARD_NAME = 'Fate Stay Night - Fifth Fuyuki Holy Grail War Narrator';
const CARD_FILE_STEM = 'Fate-Stay-Night-Fifth-Fuyuki-Holy-Grail-War-Narrator';

/** The UI edits this suite applies through the entry editor (one per test). */
const EDIT_PNG = 'PNG card round trip: Saber shattered the Grail (character-card e2e edit).';
const EDIT_JSON = 'JSON card round trip: the Grail was mended (character-card e2e edit).';

/** Decodes an exported card chunk's standard-alphabet base64 card JSON. */
function decodeCardPayload(base64: string): CardFixture {
  return JSON.parse(Buffer.from(base64, 'base64').toString('utf8')) as CardFixture;
}

/** The embedded book's entries of a decoded card JSON (an array by §3.1). */
function embeddedEntries(card: CardFixture): CardEntryFixture[] {
  const entries = card['data']['character_book']?.['entries'];
  assert(Array.isArray(entries), 'embedded book entries are an array');
  return entries as CardEntryFixture[];
}

/**
 * Opens the first entry and reads the ACTIVE tab body's content textarea
 * value (inactive mat-tabs keep their DOM — never assert against them).
 */
async function readFirstEntryContent(page: Page): Promise<string> {
  await openFirstEntry(page);
  return activeEditorPane(page)
    .getByLabel('Entry content', { exact: true })
    .inputValue();
}

test.describe('character card round trip (plan 15 §3.6)', () => {
  // Import (1.4 MB) + edit + export + byte-walk + re-import is long, most of
  // all under the WebKit simulator's actionability checks — the round-trip
  // suite's same escalation, applied to the slightly longer card flow.
  test.describe.configure({ timeout: 90_000 });

  test('card PNG: import, edit, export every non-card byte identical, re-import shows the edit', async ({
    page,
  }) => {
    await page.goto('/');
    await importLorebook(page, EXAMPLE_CARD_PNG);
    // The approved import success copy names the card source file.
    await expectSnackbar(page, 'Imported 70 entries from character card example_card.png.');
    // The project title comes from the card's data.name.
    await expect(page.locator('.project-title')).toHaveText(CARD_NAME);

    await openFirstEntry(page);
    await setEntryContent(page, EDIT_PNG);

    const download = await exportCard(page, 'PNG');
    expect(download.suggestedFilename()).toBe(`${CARD_FILE_STEM}.png`);
    // Save the download under its export name (a user's re-import picks the
    // saved file, and the success snack names the picked file — Playwright's
    // raw temp path has a GUID basename).
    const dir = mkdtempSync(join(tmpdir(), 'lorestitch-card-e2e-'));
    const exportPath = join(dir, download.suggestedFilename());
    await download.saveAs(exportPath);
    const exported = new Uint8Array(readFileSync(exportPath));

    // Byte fidelity: every chunk except the card-carrying tEXt ones is
    // identical (signature, IHDR, all IDATs, the foreign deBG chunk, IEND,
    // trailing bytes — full chunk bytes: header + data + CRC verbatim).
    const { diffs, cardChunks } = compareCardPngBytes(
      new Uint8Array(readFileSync(EXAMPLE_CARD_PNG)),
      exported,
    );
    expect(diffs, 'non-card bytes lost in the card PNG export').toEqual([]);
    // Dual-chunk card: the fixture carried chara + ccv3 and the export
    // re-embeds BOTH (no stale chunk survives).
    expect(cardChunks.map((chunk) => chunk.keyword).sort(), 'card chunks re-embedded').toEqual([
      'ccv3',
      'chara',
    ]);
    for (const chunk of cardChunks) {
      const card = decodeCardPayload(chunk.base64);
      expect(card['data']['name'], `chunk ${chunk.keyword}: card name`).toBe(CARD_NAME);
      const edited = embeddedEntries(card).filter((entry) => entry['content'] === EDIT_PNG);
      expect(edited, `chunk ${chunk.keyword}: exactly one entry carries the edit`).toHaveLength(1);
      expect(embeddedEntries(card).length, `chunk ${chunk.keyword}: entry count survives`).toBe(70);
    }

    // The exported card re-imports; the edit is visible in the editor again.
    await importViaProjectsMenu(page, exportPath);
    await expect(page.locator('.project-title')).toHaveText(CARD_NAME);
    await expectSnackbar(page, `Imported 70 entries from character card ${CARD_FILE_STEM}.png.`);
    expect(await readFirstEntryContent(page)).toBe(EDIT_PNG);
  });

  test('card JSON: import, edit, export field-faithfully, re-import shows the edit', async ({
    page,
  }) => {
    const original = JSON.parse(readFileSync(EXAMPLE_CARD_JSON, 'utf8')) as CardFixture;

    await page.goto('/');
    await importLorebook(page, EXAMPLE_CARD_JSON);
    await expectSnackbar(page, 'Imported 70 entries from character card example_card.json.');
    await expect(page.locator('.project-title')).toHaveText(CARD_NAME);

    await openFirstEntry(page);
    await setEntryContent(page, EDIT_JSON);

    const download = await exportCard(page, 'JSON');
    expect(download.suggestedFilename()).toBe(`${CARD_FILE_STEM}.json`);
    // Save the download under its export name (see the PNG test's note).
    const dir = mkdtempSync(join(tmpdir(), 'lorestitch-card-e2e-'));
    const exportPath = join(dir, download.suggestedFilename());
    await download.saveAs(exportPath);
    // Field fidelity, NOT byte identity (plan 15 §3.4): the card JSON is
    // re-serialized minified with pipeline-assigned entry ids.
    const exported = JSON.parse(readFileSync(exportPath, 'utf8')) as CardFixture;
    expect(exported['spec'], 'card spec survives').toBe(original['spec']);
    expect(exported['spec_version'], 'spec version survives').toBe(original['spec_version']);
    expect(exported['data']['name'], 'character name survives').toBe(original['data']['name']);
    // An untouched card field survives VERBATIM (the never-drop pin at card
    // level): the whole description rides the book swap untouched.
    expect(exported['data']['description'], 'description survives verbatim').toBe(
      original['data']['description'],
    );
    expect(Object.keys(exported['data']), 'data key set unchanged').toEqual(
      Object.keys(original['data']),
    );

    // The embedded book carries the edit; the dual comment/name field of the
    // profile's first entry is preserved as vendor data, never collapsed.
    const exportedEntries = embeddedEntries(exported);
    expect(exportedEntries, 'entry count survives').toHaveLength(70);
    const edited = exportedEntries.filter((entry) => entry['content'] === EDIT_JSON);
    expect(edited, 'exactly one entry carries the edit').toHaveLength(1);
    const profileEntry = exportedEntries.find((entry) => entry['comment'] === 'User apartment');
    assert(profileEntry, 'the commented-first fixture entry survives');
    expect(profileEntry['name'], 'the dual name field survives verbatim').toBe('User apartment');

    // The exported card re-imports; the edit is visible in the editor again.
    await importViaProjectsMenu(page, exportPath);
    await expect(page.locator('.project-title')).toHaveText(CARD_NAME);
    await expectSnackbar(page, `Imported 70 entries from character card ${CARD_FILE_STEM}.json.`);
    expect(await readFirstEntryContent(page)).toBe(EDIT_JSON);
  });

  test('plain lorebook: both card rows unavailable with the no-shell copy and guard snack', async ({
    page,
  }) => {
    await page.goto('/');
    await importLorebook(page, FATE_PATH);
    // Fate fixture import — the snack copy is the plain-book one; assert it
    // only to dismiss it before the menu interactions.
    await expectSnackbar(page, 'Imported');

    await openExportMenu(page);
    const pngRow = cardExportRow(page, 'Character card (PNG)');
    const jsonRow = cardExportRow(page, 'Character card (JSON)');
    for (const row of [pngRow, jsonRow]) {
      // Unavailable affordance (checkpoint 15-1, pinned by the unit spec too):
      // muted class + the approved copy on aria-description. MatMenuItem
      // always writes aria-disabled=false — never asserted here.
      await expect(row).toHaveClass(/card-export-unavailable/);
      await expect(row).toHaveAttribute('aria-description', 'Import a character card first');
    }

    // Click-guard: an unavailable row explains itself instead of exporting.
    await pngRow.click();
    await expectSnackbar(page, 'Import a character card first');

    // The real tooltip carries the same copy (desktop project only: phones
    // cannot hover — the muted class + aria-description above pin them).
    if (test.info().project.name === 'desktop-chrome') {
      await openExportMenu(page);
      await cardExportRow(page, 'Character card (PNG)').hover();
      await expect(
        page
          .locator('.mat-mdc-tooltip-panel')
          .getByText('Import a character card first', { exact: true }),
      ).toBeVisible();
      // Release the pointer so the bubble cannot cover later targets.
      await page.mouse.move(0, 0);
    }
  });

  test('card JSON project: PNG row mutes with the no-image copy, JSON row ready', async ({
    page,
  }) => {
    await page.goto('/');
    await importLorebook(page, EXAMPLE_CARD_JSON);
    await expectSnackbar(page, 'Imported 70 entries from character card example_card.json.');

    await openExportMenu(page);
    const pngRow = cardExportRow(page, 'Character card (PNG)');
    await expect(pngRow).toHaveClass(/card-export-unavailable/);
    await expect(pngRow).toHaveAttribute(
      'aria-description',
      'No card image stored — import a card PNG first',
    );
    const jsonRow = cardExportRow(page, 'Character card (JSON)');
    await expect(jsonRow).not.toHaveClass(/card-export-unavailable/);
    // A ready row carries no aria-description and no guard copy.
    expect(await jsonRow.getAttribute('aria-description')).toBeNull();

    // The unavailable PNG row still explains itself on click.
    await pngRow.click();
    await expectSnackbar(page, 'No card image stored — import a card PNG first');

    // The JSON row is live — the export + re-import voyage is the round-trip
    // test above; here it must merely not be a dead end: enabled, no guard
    // copy (pinned above).
  });

  test('not a card PNG: failure copy snacks and the welcome screen stays', async ({ page }) => {
    // A tiny VALID PNG (built in-test: §3.7 forbids touching the fixtures)
    // with no card chunk walks clean and must refuse with the approved copy.
    const dir = mkdtempSync(join(tmpdir(), 'lorestitch-card-e2e-'));
    const path = join(dir, 'not-a-card.png');
    writeFileSync(path, buildNonCardPng());

    await page.goto('/');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import lorebook or character card' }).click();
    await (await chooser).setFiles(path);
    await expectSnackbar(page, 'Not a character card — no embedded lorebook found in the PNG.');
    // The failure kept the app project-less: the welcome screen remains.
    await expect(page.locator('app-welcome-screen')).toBeVisible();
  });
});
