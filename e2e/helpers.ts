import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Download, type Locator, type Page } from '@playwright/test';
import {
  PNG_SIGNATURE,
  concatBytes,
  pngChunk,
  walkSpecPng,
  type SpecChunk,
} from '../src/testing/png-fixtures';

/** The bundled Fate/Stay Night fixture most suites import. */
export const FATE_PATH = join(
  process.cwd(),
  'example_card',
  'Fate Stay Night - Fuyuki Lorebook(1).json',
);

/**
 * The user-provided character-card fixtures (plan 15 §3.7) — imported through
 * the same helpers as the lorebook fixtures, never modified by a spec.
 */
export const EXAMPLE_CARD_PNG = join(process.cwd(), 'example_card', 'example_card.png');
export const EXAMPLE_CARD_JSON = join(process.cwd(), 'example_card', 'example_card.json');

/**
 * The card rows' menu titles (checkpoint 15-1 copy, verbatim everywhere).
 */
export type CardExportTitle = 'Character card (PNG)' | 'Character card (JSON)';

/**
 * Imports a lorebook file through the welcome screen, replacing the project.
 * The caller is responsible for navigating to `/` first.
 */
export async function importLorebook(page: Page, path: string): Promise<void> {
  const importChooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import lorebook or character card' }).click();
  await (await importChooser).setFiles(path);
  // Assert the project-open top bar, not merely an attached sidenav: the
  // welcome state also renders a sidenav, so a silently failed import would
  // otherwise slip through and every later editor interaction would time out.
  await expect(page.locator('[aria-label="More actions menu"]')).toBeVisible();
  await expect(page.locator('.entries-sidenav')).toBeAttached();
}

/** Exports via the top bar menu; resolves with the parsed JSON and its file. */
export async function exportWorldInfo(
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

/**
 * Creates a project through the welcome screen so the studio shell appears.
 * The title labels the project only; every spec starts from the same empty book.
 */
export async function createProject(page: Page, title: string): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel('Project title').fill(title);
  await page.getByRole('button', { name: 'Create Project' }).click();
  await expect(page.locator('[aria-label="More actions menu"]')).toBeVisible();
  await expect(page.locator('.entries-sidenav')).toBeAttached();
}

/**
 * Opens the first visible entry (its tab becomes the active editor pane).
 *
 * Viewport-aware: below the shell's 768px breakpoint the entries sidenav is
 * an off-canvas `over` drawer, so it is toggled open before the click and
 * released again afterwards (the editor renders behind it).
 */
export async function openFirstEntry(page: Page): Promise<void> {
  const viewport = page.viewportSize();
  const mobile = viewport !== null && viewport.width < 768;
  const drawerToggle = page.locator('[aria-label="Toggle entries panel"]');
  if (mobile) {
    await drawerToggle.click();
    await expect(page.getByRole('heading', { name: 'Entries' })).toBeVisible();
  }
  await page.locator('.entry-item').first().click();
  await expect(page.locator('app-entry-editor .entry-tabs')).toBeVisible();
  if (mobile) {
    // Release the drawer so the editor pane behind it is interactable, and
    // re-zero the workspace in case the drawer-close focus restore panned it
    // sideways (see delimiters' phone choreography for the same settle).
    await drawerToggle.click();
    await expect(page.locator('.entries-sidenav')).not.toBeInViewport();
    await page.evaluate(() => {
      const workspace = document.querySelector('.workspace') as HTMLElement | null;
      if (workspace) {
        workspace.scrollLeft = 0;
      }
    });
  }
}

/**
 * Checks the selection checkboxes of the first two visible entry rows.
 *
 * Viewport-aware: below the shell's 768px breakpoint the entries sidenav is
 * an off-canvas `over` drawer, so the rows (and their checkboxes) are not
 * visible until the drawer is toggled open. The `Batch actions` toolbar that
 * appears with the selection keeps one DOM contract everywhere — role,
 * aria-label, the `N selected` count — but its location is
 * breakpoint-dependent by design (Task 06 §3.2): the inline header toolbar
 * inside the drawer on tablet/desktop, the docked bottom bar's transplanted
 * toolbar on phones. The single `getByRole` assertion below therefore
 * resolves to the bar's strip on phones and to the drawer's header on wider
 * viewports — callers need no viewport branch.
 */
export async function selectFirstTwoRows(page: Page): Promise<void> {
  const viewport = page.viewportSize();
  if (viewport && viewport.width < 768) {
    await page.locator('[aria-label="Toggle entries panel"]').click();
    await expect(page.getByRole('heading', { name: 'Entries' })).toBeVisible();
  }
  const rows = page.locator('.entry-item');
  await rows.first().locator('.row-select').click();
  await rows.nth(1).locator('.row-select').click();
  await expect(page.getByRole('toolbar', { name: 'Batch actions' })).toContainText(
    '2 selected',
  );
}

/**
 * Asserts the last snackbar shows `text` and then waits out its auto-dismiss:
 * on phones the bar spans the viewport bottom edge and would otherwise cover
 * the next action target (the mobile-bottom-bar choreography precedent).
 */
export async function expectSnackbar(page: Page, text: string): Promise<void> {
  await expect(page.locator('.mat-mdc-snack-bar-label').last()).toContainText(text);
  await page
    .locator('.mat-mdc-snack-bar-container')
    .last()
    .waitFor({ state: 'detached', timeout: 9_000 });
}

/**
 * Opens the export menu with the shell's viewport-aware trigger: the topbar's
 * standalone Export button on tablets/desktops, the mobile bottom bar's
 * Export item on phones (below the shell's 768px breakpoint — the same branch
 * every helper here uses). Returns the open menu panel, the scope for its
 * rows: the two menus declare identically-classed panels, but only one can be
 * open at a time.
 */
export async function openExportMenu(page: Page): Promise<Locator> {
  const viewport = page.viewportSize();
  if (viewport !== null && viewport.width < 768) {
    await page
      .locator('app-mobile-bottom-bar nav .bar-item')
      .filter({ hasText: 'Export' })
      .click();
  } else {
    await page.locator('[aria-label="Export menu"]').click();
  }
  const panel = page.locator('.mat-mdc-menu-panel.export-menu');
  await expect(panel).toBeVisible();
  return panel;
}

/** A "Character card" row in an open export menu panel. */
export function cardExportRow(page: Page, title: CardExportTitle): Locator {
  return page
    .locator('.mat-mdc-menu-panel.export-menu button.mat-mdc-menu-item')
    .filter({ hasText: title });
}

/**
 * Exports a character card through the export menu; resolves with the
 * `Download`. The rows unavailable at click time are covered by
 * `cardExportRow`-scoped availability assertions in the spec, not here.
 */
export async function exportCard(page: Page, flavor: 'PNG' | 'JSON'): Promise<Download> {
  await openExportMenu(page);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    cardExportRow(page, `Character card (${flavor})`).click(),
  ]);
  return download;
}

/**
 * Re-imports a saved/exported file through the projects menu ('Open lorebook
 * or card…'), the only import picker reachable with a project already open.
 * The round-trip spec drives this same flow inline; it lives here so the
 * card suite reuses it without editing that spec.
 */
export async function importViaProjectsMenu(page: Page, path: string): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.locator('[aria-label="Projects menu"]').click();
  await page.getByText('Open lorebook or card').click();
  await (await chooser).setFiles(path);
  await expect(page.locator('[aria-label="More actions menu"]')).toBeVisible();
  await expect(page.locator('.entries-sidenav')).toBeAttached();
}

/** The active entry editor pane — inactive mat-tabs keep their DOM. */
export function activeEditorPane(page: Page): Locator {
  return page.locator('.mat-mdc-tab-body-active');
}

/**
 * Fills the active entry's content textarea and re-reads it back. Scoped to
 * the active tab body (inactive mat-tabs keep their inputs in the DOM).
 */
export async function setEntryContent(page: Page, content: string): Promise<void> {
  const textarea = activeEditorPane(page).getByLabel('Entry content', { exact: true });
  await textarea.fill(content);
  await expect(textarea).toHaveValue(content);
}

// -----------------------------------------------------------------------------
// Character-card PNG byte fidelity (plan 15 §3.6 e2e row)
// -----------------------------------------------------------------------------

/** The tEXt keywords that carry card payloads (plan 15 §3.1, dual-chunk). */
const CARD_CHUNK_KEYWORDS = ['chara', 'ccv3'] as const;

/** True when the chunk is a tEXt carrying a card payload (`chara`/`ccv3`). */
function isCardChunk(chunk: SpecChunk): boolean {
  if (chunk.type !== 'tEXt') {
    return false;
  }
  const nul = chunk.data.indexOf(0);
  if (nul === undefined || nul < 0) {
    return false;
  }
  const keyword = Buffer.from(chunk.data.subarray(0, nul)).toString('latin1');
  return (CARD_CHUNK_KEYWORDS as readonly string[]).includes(keyword);
}

/** Byte-for-byte equality over two `Uint8Array`s. */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

/** A decoded card payload of an exported card PNG: keyword + base64 card JSON. */
export interface ExportedCardChunk {
  readonly keyword: string;
  /** The tEXt payload text — standard base64 of the card JSON. */
  readonly base64: string;
}

/**
 * Byte-compares a card PNG export against its fixture shell (plan 15 §3.6:
 * "byte-compare the exported PNG against the fixture shell for all non-card
 * bytes"). Structural, not positional: re-embedding may re-serialize the card
 * payload at a different length, so chunk offsets may shift — the chunk
 * SEQUENCE must match instead, and every chunk except the card-carrying
 * tEXt ones must be byte-identical (header + data + CRC):
 * signature, IHDR, all IDATs, foreign chunks (`deBG`), IEND, trailing bytes.
 * Returns the exported card chunks for the caller's payload assertions.
 */
export function compareCardPngBytes(
  fixtureBytes: Uint8Array,
  exportedBytes: Uint8Array,
): { diffs: string[]; cardChunks: ExportedCardChunk[] } {
  const diffs: string[] = [];
  const cardChunks: ExportedCardChunk[] = [];

  if (!sameBytes(fixtureBytes.subarray(0, 8), exportedBytes.subarray(0, 8))) {
    diffs.push('PNG signature differs');
  }
  const fixtureChunks = walkSpecPng(fixtureBytes);
  const exportedChunks = walkSpecPng(exportedBytes);
  if (fixtureChunks.length !== exportedChunks.length) {
    diffs.push(`chunk count ${fixtureChunks.length} → ${exportedChunks.length}`);
  }

  const count = Math.min(fixtureChunks.length, exportedChunks.length);
  for (let i = 0; i < count; i++) {
    const fixture = fixtureChunks[i];
    assert(fixture, `fixture walk missing chunk ${i}`);
    const exported = exportedChunks[i];
    assert(exported, `exported walk missing chunk ${i}`);
    if (fixture.type !== exported.type) {
      diffs.push(`chunk ${i}: type ${fixture.type} → ${exported.type}`);
      continue;
    }
    if (isCardChunk(exported)) {
      const nul = exported.data.indexOf(0);
      cardChunks.push({
        keyword: Buffer.from(exported.data.subarray(0, nul === undefined ? 0 : nul)).toString(
          'latin1',
        ),
        base64: Buffer.from(exported.data.subarray((nul === undefined ? 0 : nul) + 1)).toString(
          'latin1',
        ),
      });
      continue; // The book was edited — the card payload MUST differ.
    }
    const fixtureSpan = fixtureBytes.subarray(
      fixture.chunkStart,
      fixture.chunkStart + 12 + fixture.data.length,
    );
    const exportedSpan = exportedBytes.subarray(
      exported.chunkStart,
      exported.chunkStart + 12 + exported.data.length,
    );
    if (!sameBytes(fixtureSpan, exportedSpan)) {
      diffs.push(`chunk ${i} (${fixture.type}): non-card bytes differ`);
    }
  }

  // Trailing bytes after IEND (both files must end at the same point).
  const lastFixture = fixtureChunks[fixtureChunks.length - 1];
  const lastExported = exportedChunks[exportedChunks.length - 1];
  assert(lastFixture && lastExported, 'both files must end with a walked chunk');
  const fixtureEnd = lastFixture.chunkStart + 12 + lastFixture.data.length;
  const exportedEnd = lastExported.chunkStart + 12 + lastExported.data.length;
  const fixtureTail = fixtureBytes.subarray(Math.min(fixtureEnd, fixtureBytes.length));
  const exportedTail = exportedBytes.subarray(Math.min(exportedEnd, exportedBytes.length));
  if (!sameBytes(fixtureTail, exportedTail)) {
    diffs.push('trailing bytes after the final chunk differ');
  }
  return { diffs, cardChunks };
}

/**
 * A tiny VALID PNG (1×1 IHDR data, valid CRCs, no IDAT, no card chunk) for
 * the not-a-card failure path — built here because §3.6 forbids touching the
 * fixture files and the codec only walks chunks (it never renders pixels).
 */
export function buildNonCardPng(): Uint8Array {
  return concatBytes(
    PNG_SIGNATURE,
    pngChunk('IHDR', Uint8Array.of(0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0)),
    pngChunk('IEND', new Uint8Array(0)),
  );
}
