import { DOCUMENT, Service, inject } from '@angular/core';
import {
  CharacterBook,
  LoreFileFormat,
  SillyTavernWorldInfo,
  characterBookToStNative,
  detectLoreFileFormat,
  entryTitle,
  extractSubBook,
  isCharacterBook,
  isSillyTavernWorldInfo,
  normalizeBookPositions,
  normalizeImportedBook,
  stNativeToCharacterBook,
  toSpecCompliantBook,
} from '../models/lorebook.model';
import {
  LORESTITCH_ARCHIVE_VERSION,
  deserializeWorkspaceFromArchive,
  isProjectWorkspace,
  sanitizeLintPrefs,
  serializeWorkspaceForArchive,
  type CardShell,
  type ProjectWorkspace,
} from '../models/project.model';
import {
  embedBookIntoCardJson,
  embedCardPayloads,
  openCardJson,
  openCardPng,
  updatedCardPayloads,
  type CardError,
  type CardErrorReason,
  type OpenedCard,
} from '../models/character-card';
import { isJsonObject } from '../models/lorebook.model';
import { type BookDefect, validateBook } from '../models/book-schema';
import { type BookRepair, planBookRepair } from '../models/book-repair';
import { estimateTokens } from './token-estimator';

/** Result of parsing an imported JSON document. */
export interface ParsedImport {
  format: LoreFileFormat;
  book: CharacterBook;
  workspace?: ProjectWorkspace;
  suggestedTitle: string;
  /**
   * The character-card container the file was opened from (plan 15 §3.3) —
   * present only for card imports; plain books and `.stproj` archives never
   * set it (an archive's shell, if any, rides inside `workspace.cardShell`).
   */
  cardShell?: CardShell;
}

/**
 * Optional payloads from the import source (plan 15 §3.3): the caller owns
 * the `File` reads, and a card open needs more than parsed JSON — the card
 * JSON verbatim (the export swap must keep its key order) or the PNG bytes
 * (the export shell).
 */
export interface ImportSourcePayload {
  /** Verbatim file text of a text import. */
  rawText?: string;
  /** PNG bytes of a card-image import. */
  pngBytes?: Uint8Array;
}

/**
 * Result of the card-aware import entry (plan 15 §3.3). `card-error` carries
 * the card boundary's refusal so the caller's snackbar can use the approved
 * per-reason copy; the plain `parseImport` entry folds the same branch into
 * `null` (its historical "unsupported" outcome).
 */
export type CardImportParse =
  | { readonly status: 'ok'; readonly parsed: ParsedImport }
  | { readonly status: 'card-error'; readonly error: CardError };

/**
 * Failure surface of the two card exports (plan 15 §3.5). Codec refusals ride
 * the card boundary's own reason; the shell preconditions add `no-shell` /
 * `no-image`. `message` is informational — user-facing copy is keyed by
 * `reason` (the approved table in `project-actions.constants.ts`).
 */
export type CardExportFailureReason = CardErrorReason | 'no-shell' | 'no-image';

export interface CardExportFailure {
  readonly reason: CardExportFailureReason;
  readonly message: string;
}

/**
 * Result of the book-carrying exports (plan 09 §3.5): every method runs
 * `validateBook` on the exact book it is about to serialize BEFORE any bytes
 * are produced. `ok: true` means the book was clean and the download fired —
 * the bytes are identical to the pre-validation behavior, validation only
 * observes. `ok: false` means no `download*` method was called; `defects`
 * carry the findings, and `repair` is the one-click plan for the fixable
 * subset (`null` when the defects admit no repair — hard-block territory).
 * Callers may ignore the result for now; the repair-dialog surfacing is a
 * later phase (plan 09 §3.5 P2).
 */
export type ExportResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly defects: BookDefect[];
      readonly repair: BookRepair | null;
      /**
       * Additive (plan 09 deviation, P1): present only on `exportProject`'s
       * snapshot hard-block. Snapshots are history — not repairable
       * in-session — so the failure must be attributable: a human label
       * naming the offending commit (`"<message> (<id prefix>)"`), for the UI
       * to surface verbatim.
       */
      readonly source?: string;
    };

/**
 * Card-JSON export availability (plan 15 §3.5): any shell — a card JSON was
 * the import source or the card PNG carried one. The menu disabled state and
 * the export methods share this predicate.
 */
export function cardJsonExportAvailable(project: ProjectWorkspace | null): boolean {
  return project?.cardShell !== undefined;
}

/**
 * Card-PNG export availability: the shell must remember the original image
 * bytes and the chunk keyword they came from (JSON-card shells cannot embed).
 */
export function cardPngExportAvailable(project: ProjectWorkspace | null): boolean {
  const shell = project?.cardShell;
  return shell !== undefined && shell.pngBytes !== undefined && shell.pngKeyword !== undefined;
}

export interface MarkdownDigestOptions {
  includeDisabled?: boolean;
}

/**
 * Import-only normalization for the optional `lintPrefs` field of a `.stproj`
 * workspace (plan 03 §3.6.5.2): an absent field passes the workspace through
 * verbatim (old archives load exactly as before); a present field is run
 * through `sanitizeLintPrefs`, and a wholly malformed one is dropped rather
 * than kept as a type-violating value.
 */
function withSanitizedLintPrefs(workspace: ProjectWorkspace): ProjectWorkspace {
  if (workspace.lintPrefs === undefined) {
    return workspace;
  }
  const prefs = sanitizeLintPrefs(workspace.lintPrefs);
  if (prefs === undefined) {
    // `_malformed` is exempt from no-unused-vars via varsIgnorePattern.
    const { lintPrefs: _malformed, ...withoutPrefs } = workspace;
    return withoutPrefs;
  }
  return { ...workspace, lintPrefs: prefs };
}

/**
 * Import auto-detection and export for all supported LoreStitch formats.
 * Files are produced/consumed via `Blob` + `URL.createObjectURL`.
 */
@Service()
export class ImportExportService {
  private readonly document = inject(DOCUMENT);

  /**
   * Reads a `File` as text. Text imports are JSON; card PNGs bypass this —
   * they take the bytes path (`parseCardImport` with `pngBytes`), since
   * decoding card bytes as text would corrupt the base64 payload.
   */
  async readFileText(file: File): Promise<string> {
    return file.text();
  }

  /**
   * Parses imported JSON and auto-detects its format: a bare
   * `CharacterBook`, a LoreStitch `.stproj` archive, or a native SillyTavern
   * world-info export. Every branch is validated by a type guard first —
   * malformed payloads return `null` so the caller shows its
   * unsupported-format error instead of persisting a book that would crash
   * on render.
   *
   * Plan 15 §3.3: when the sniff fails all three lorebook shapes, a card
   * source (raw text or PNG bytes) opens through the card boundary
   * (`openCardJson` / `openCardPng`) and the extracted book flows through the
   * exact same import pipeline as a plain book. Failures return `null` like
   * any unrecognized payload; callers that need the refusal reason (for the
   * approved per-reason snackbar copy) use `parseCardImport`, which shares
   * this branch's implementation.
   */
  parseImport(
    json: unknown,
    fallbackTitle = 'Imported Lorebook',
    source?: ImportSourcePayload,
  ): ParsedImport | null {
    const format = detectLoreFileFormat(json);
    if (!format) {
      if (source?.pngBytes !== undefined) {
        const card = this.parseCardImport({ pngBytes: source.pngBytes }, fallbackTitle);
        return card.status === 'ok' ? card.parsed : null;
      }
      if (typeof source?.rawText === 'string') {
        const card = this.parseCardImport({ rawText: source.rawText }, fallbackTitle);
        return card.status === 'ok' ? card.parsed : null;
      }
      return null;
    }

    switch (format) {
      case 'sillytavern_native': {
        if (!isSillyTavernWorldInfo(json)) {
          return null;
        }
        const book = stNativeToCharacterBook(json as SillyTavernWorldInfo, fallbackTitle);
        return {
          format,
          book,
          suggestedTitle: book.name || fallbackTitle,
        };
      }
      case 'stproj': {
        const archive = json as Record<string, unknown>;
        // Future archive versions may carry a workspace shape this build
        // cannot understand — reject instead of importing a corrupt project.
        if (archive['version'] !== undefined && archive['version'] !== LORESTITCH_ARCHIVE_VERSION) {
          return null;
        }
        if (!isProjectWorkspace(archive['workspace'])) {
          return null;
        }
        const workspace: ProjectWorkspace = archive['workspace'];
        return {
          format,
          // lintPrefs (plan 03 §3.6.5.2) is LoreStitch-owned workspace
          // metadata: sanitized resiliently at import — malformed parts are
          // dropped, never an archive rejection; an absent field passes the
          // workspace through verbatim (see withSanitizedLintPrefs).
          // The card shell's `pngBytesBase64` (plan 15 §3.2) is decoded back
          // into `pngBytes` the same way — absent shells pass through
          // untouched, so old archives load byte-for-byte as before.
          workspace: withSanitizedLintPrefs(deserializeWorkspaceFromArchive(workspace)),
          book: workspace.activeBook,
          suggestedTitle: workspace.title || fallbackTitle,
        };
      }
      default: {
        if (!isCharacterBook(json)) {
          return null;
        }
        const book = normalizeBookPositions(
          normalizeImportedBook(structuredClone(json as CharacterBook)),
        );
        return {
          format: 'character_book',
          book,
          suggestedTitle: book.name || fallbackTitle,
        };
      }
    }
  }

  // -------------------------------------------------------------------------
  // Card imports (plan 15 §3.3)
  // -------------------------------------------------------------------------

  /**
   * Card-aware import entry: never throws. PNG bytes open through
   * `openCardPng`, raw text through `openCardJson` — both return their
   * refusal reason so the caller's snackbar can use the approved per-reason
   * copy (checkpoint 15-1) instead of the generic unsupported-format error.
   */
  parseCardImport(
    source: ImportSourcePayload,
    fallbackTitle = 'Imported Lorebook',
  ): CardImportParse {
    const opened = source.pngBytes !== undefined ? openCardPng(source.pngBytes) : undefined;
    const openedJson =
      opened === undefined && typeof source.rawText === 'string'
        ? openCardJson(source.rawText)
        : undefined;
    const result = opened ?? openedJson;
    if (result === undefined) {
      // No source payload to open — a caller bug, but total by contract.
      return {
        status: 'card-error',
        error: {
          reason: 'not-a-card',
          message: 'The import source carries neither card text nor PNG bytes.',
        },
      };
    }
    if ('reason' in result) {
      return { status: 'card-error', error: result };
    }
    const parsed = this.parsedImportFromCard(result, fallbackTitle);
    return 'reason' in parsed ? { status: 'card-error', error: parsed } : { status: 'ok', parsed };
  }

  /**
   * The card's extracted book through the EXACT plain-book import pipeline
   * (`isCharacterBook` guard → `normalizeImportedBook` → position
   * normalization), plus the shell the card exports re-embed into. A
   * wrong-typed embedded book refuses with `card-json-invalid` (the card
   * opened, but there is no book to edit — the approved copy table renders it
   * as invalid card JSON).
   */
  private parsedImportFromCard(
    opened: OpenedCard,
    fallbackTitle: string,
  ): ParsedImport | CardError {
    if (!isCharacterBook(opened.rawBook)) {
      return {
        reason: 'card-json-invalid',
        message: 'The card payload is not valid JSON.',
      };
    }
    const book = normalizeBookPositions(normalizeImportedBook(structuredClone(opened.rawBook)));
    // Shell assembly is a plain property copy (P1 report): OpenedCard mirrors
    // the shell field-for-field minus `rawBook`/`warnings`.
    const { spec, cardJson, pngBytes, pngKeyword, extraCardJson } = opened;
    const cardShell: CardShell = {
      spec,
      cardJson,
      ...(pngKeyword !== undefined ? { pngKeyword } : {}),
      ...(pngBytes !== undefined ? { pngBytes } : {}),
      ...(extraCardJson !== undefined ? { extraCardJson } : {}),
    };
    return {
      format: 'character_book',
      book,
      suggestedTitle: cardDisplayName(cardJson) || book.name || fallbackTitle,
      cardShell,
    };
  }

  // -------------------------------------------------------------------------
  // Exports
  // -------------------------------------------------------------------------

  /**
   * Clean SillyTavern CharacterBook JSON (V2 schema, no LoreStitch extras).
   * Validates first (plan 09 §3.5): a defective book returns its findings and
   * repair plan instead of downloading.
   */
  exportCharacterBook(book: CharacterBook, title: string): ExportResult {
    const defects = validateBook(book);
    if (defects.length > 0) {
      return { ok: false, defects, repair: planBookRepair(book, defects) };
    }
    this.downloadJson(toSpecCompliantBook(book), `${this.fileName(title)}-lorebook.json`);
    return { ok: true };
  }

  /**
   * Native SillyTavern world-info JSON, directly importable into ST.
   * Validates first (plan 09 §3.5) — the uid-keyed bag silently collapses
   * duplicate ids, so the pre-flight is what keeps malformed bytes off disk.
   */
  exportStNative(book: CharacterBook, title: string): ExportResult {
    const defects = validateBook(book);
    if (defects.length > 0) {
      return { ok: false, defects, repair: planBookRepair(book, defects) };
    }
    this.downloadJson(characterBookToStNative(book), `${this.fileName(title)}-world-info.json`);
    return { ok: true };
  }

  /**
   * Modular split export: writes only the selected entries as a standalone
   * lorebook file (see `extractSubBook` for how the sub-book is derived).
   * Validates the SUB-BOOK — that is the book being written (plan 09 §3.5).
   */
  exportSelectedBook(
    book: CharacterBook,
    entryIds: readonly number[],
    title: string,
    format: 'st_native' | 'character_book',
  ): ExportResult {
    const subBook = extractSubBook(book, entryIds, title);
    const defects = validateBook(subBook);
    if (defects.length > 0) {
      return { ok: false, defects, repair: planBookRepair(subBook, defects) };
    }
    return format === 'character_book'
      ? this.exportCharacterBook(subBook, title)
      : this.exportStNative(subBook, title);
  }

  /**
   * Full project archive including the commit history. Validates the
   * activeBook AND every commit snapshot (plan 09 §3.5): snapshots are
   * history — not repairable in-session — so a defective snapshot hard-blocks
   * with `repair: null` and `source` naming its commit. Snapshots are checked
   * first: the block is terminal (no repair exists), and reporting the
   * activeBook's fixable defects first would route the user into a repair
   * that cannot unblock the archive.
   */
  exportProject(project: ProjectWorkspace): ExportResult {
    for (const commit of project.commits) {
      const snapshotDefects = validateBook(commit.snapshot);
      if (snapshotDefects.length > 0) {
        return {
          ok: false,
          defects: snapshotDefects,
          repair: null,
          source: `${commit.message} (${commit.id.slice(0, 7)})`,
        };
      }
    }
    const defects = validateBook(project.activeBook);
    if (defects.length > 0) {
      return { ok: false, defects, repair: planBookRepair(project.activeBook, defects) };
    }
    const archive = {
      format: 'lorestitch-project' as const,
      version: LORESTITCH_ARCHIVE_VERSION,
      exportedAt: new Date().toISOString(),
      // The card shell's PNG bytes (plan 15 §3.2) cannot ride JSON.stringify
      // (a Uint8Array serializes as a keyed object) — the transform
      // re-encodes them as explicit base64 (`pngBytesBase64`); a workspace
      // without a shell serializes identically to before.
      workspace: serializeWorkspaceForArchive(project),
    };
    this.downloadJson(archive, `${this.fileName(project.title)}.stproj`);
    return { ok: true };
  }

  /**
   * "Character card (PNG)" (plan 15 §3.4): re-embeds the edited book into the
   * shell's original card image — every non-card byte (IDATs, foreign chunks)
   * stays identical, the updated payloads ride the same chunks the source
   * had. Refuses without a shell that remembers the image (`no-image` / a
   * JSON-card shell) or when a chunk would keep a stale book
   * (`stale-card-chunk`). Returns the failure for the caller's snackbar;
   * `null` means the download fired.
   */
  exportCardPng(project: ProjectWorkspace): CardExportFailure | null {
    const shell = project.cardShell;
    if (shell === undefined) {
      return {
        reason: 'no-shell',
        message: 'The project holds no character-card shell.',
      };
    }
    if (shell.pngBytes === undefined || shell.pngKeyword === undefined) {
      return {
        reason: 'no-image',
        message: 'The card shell stores no card image — import a card PNG first.',
      };
    }
    const payloads = updatedCardPayloads(
      {
        cardJson: shell.cardJson,
        pngKeyword: shell.pngKeyword,
        extraCardJson: shell.extraCardJson,
      },
      project.activeBook,
    );
    if ('reason' in payloads) {
      return payloads;
    }
    const png = embedCardPayloads(shell.pngBytes, payloads);
    if ('reason' in png) {
      return png;
    }
    this.downloadBytes(
      png,
      `${this.fileName(cardDisplayName(shell.cardJson) ?? project.title)}.png`,
      'image/png',
    );
    return null;
  }

  /**
   * "Character card (JSON)" (plan 15 §3.4): swaps the edited book into the
   * shell's card JSON — every other card field survives verbatim (minified,
   * field-faithful, never byte-identical). Requires any shell; a JSON-card
   * shell is enough. Downloaded under the card's own name, falling back to
   * the project title when the card carries none.
   */
  exportCardJson(project: ProjectWorkspace): CardExportFailure | null {
    const shell = project.cardShell;
    if (shell === undefined) {
      return {
        reason: 'no-shell',
        message: 'The project holds no character-card shell.',
      };
    }
    const cardJson = embedBookIntoCardJson(shell.cardJson, project.activeBook);
    if (typeof cardJson !== 'string') {
      return cardJson;
    }
    this.download(
      cardJson,
      `${this.fileName(cardDisplayName(shell.cardJson) ?? project.title)}.json`,
      'application/json',
    );
    return null;
  }

  /**
   * Proofread/digest export in Markdown:
   * `### [name] (Order: n | Keys: a, b)` followed by the entry content.
   * Stays `void` and unvalidated by design (plan 09 §3.5): a proofreading
   * artifact, never an ST input — defective books still digest.
   */
  exportMarkdownDigest(
    book: CharacterBook,
    title: string,
    options: MarkdownDigestOptions = {},
  ): void {
    const includeDisabled = options.includeDisabled ?? true;
    // The header statistics describe exactly the entries listed below —
    // an includeDisabled filter must apply to the numbers too.
    const entries = [...book.entries]
      .filter((e) => includeDisabled || e.enabled)
      .sort((a, b) => a.insertion_order - b.insertion_order);

    const lines: string[] = [
      `# ${book.name ?? title} — Proofread Digest`,
      '',
      `${entries.length} entries · ~${estimateTokens(
        entries.map((e) => e.content).join('\n'),
      )} tokens (rough)`,
      '',
    ];

    for (const entry of entries) {
      const keys = entry.keys.join(', ') || 'constant';
      const status = entry.enabled ? '' : ' (disabled)';
      lines.push(
        `### [${entryTitle(entry)}]${status} (Order: ${entry.insertion_order} | Keys: ${keys})`,
      );
      lines.push(entry.content);
      lines.push('---');
    }

    this.download(
      lines.join('\n'),
      `${this.fileName(title)}-digest.md`,
      'text/markdown;charset=utf-8',
    );
  }

  /** Triggers a browser download for a JSON payload. */
  downloadJson(data: unknown, fileName: string): void {
    this.download(JSON.stringify(data, null, 2), fileName, 'application/json');
  }

  download(content: string, fileName: string, mime: string): void {
    this.downloadBlob(new Blob([content], { type: mime }), fileName);
  }

  /** Triggers a browser download for a binary payload (the card PNG export). */
  private downloadBytes(bytes: Uint8Array, fileName: string, mime: string): void {
    // Blob wants a concrete ArrayBuffer: copy the exact byte range out of the
    // (possibly larger) underlying buffer.
    const copy = bytes.slice().buffer as ArrayBuffer;
    this.downloadBlob(new Blob([copy], { type: mime }), fileName);
  }

  private downloadBlob(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const anchor = this.document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    // Revoke on the next tick so the download has started.
    setTimeout(() => URL.revokeObjectURL(url));
  }

  private fileName(title: string): string {
    return (title || 'lorestitch').replace(/[^\w\d-]+/g, '-').replace(/-+/g, '-');
  }
}

/**
 * The card's display name (`data.name`), or undefined when the payload is
 * unreadable or carries no non-blank name — used for the suggested project
 * title at import and the export file name (plan 15 §3.4: the card name, not
 * the project title, when they differ).
 */
function cardDisplayName(cardJson: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(cardJson);
  } catch {
    return undefined;
  }
  if (!isJsonObject(parsed) || !isJsonObject(parsed['data'])) {
    return undefined;
  }
  const name = parsed['data']['name'];
  if (typeof name !== 'string' || name.trim() === '') {
    return undefined;
  }
  return name;
}
