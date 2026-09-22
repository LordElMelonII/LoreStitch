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
  isProjectWorkspace,
  sanitizeLintPrefs,
  type ProjectWorkspace,
} from '../models/project.model';
import { estimateTokens } from './token-estimator';

/** Result of parsing an imported JSON document. */
export interface ParsedImport {
  format: LoreFileFormat;
  book: CharacterBook;
  workspace?: ProjectWorkspace;
  suggestedTitle: string;
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

  /** Reads a `File` as text (imports are JSON only). */
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
   */
  parseImport(json: unknown, fallbackTitle = 'Imported Lorebook'): ParsedImport | null {
    const format = detectLoreFileFormat(json);
    if (!format) {
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
          workspace: withSanitizedLintPrefs(workspace),
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
  // Exports
  // -------------------------------------------------------------------------

  /** Clean SillyTavern CharacterBook JSON (V2 schema, no LoreStitch extras). */
  exportCharacterBook(book: CharacterBook, title: string): void {
    this.downloadJson(toSpecCompliantBook(book), `${this.fileName(title)}-lorebook.json`);
  }

  /** Native SillyTavern world-info JSON, directly importable into ST. */
  exportStNative(book: CharacterBook, title: string): void {
    this.downloadJson(characterBookToStNative(book), `${this.fileName(title)}-world-info.json`);
  }

  /**
   * Modular split export: writes only the selected entries as a standalone
   * lorebook file (see `extractSubBook` for how the sub-book is derived).
   */
  exportSelectedBook(
    book: CharacterBook,
    entryIds: readonly number[],
    title: string,
    format: 'st_native' | 'character_book',
  ): void {
    const subBook = extractSubBook(book, entryIds, title);
    if (format === 'character_book') {
      this.exportCharacterBook(subBook, title);
    } else {
      this.exportStNative(subBook, title);
    }
  }

  /** Full project archive including the commit history. */
  exportProject(project: ProjectWorkspace): void {
    const archive = {
      format: 'lorestitch-project' as const,
      version: LORESTITCH_ARCHIVE_VERSION,
      exportedAt: new Date().toISOString(),
      workspace: structuredClone(project),
    };
    this.downloadJson(archive, `${this.fileName(project.title)}.stproj`);
  }

  /**
   * Proofread/digest export in Markdown:
   * `### [name] (Order: n | Keys: a, b)` followed by the entry content.
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
    const blob = new Blob([content], { type: mime });
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
