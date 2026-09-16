import { DOCUMENT, Service, inject } from '@angular/core';
import {
  CharacterBook,
  LoreFileFormat,
  LORESTITCH_ARCHIVE_VERSION,
  ProjectWorkspace,
  SillyTavernWorldInfo,
  characterBookToStNative,
  detectLoreFileFormat,
  entryTitle,
  extractSubBook,
  isCharacterBook,
  isProjectWorkspace,
  isSillyTavernWorldInfo,
  normalizeBookPositions,
  normalizeImportedBook,
  stNativeToCharacterBook,
  toSpecCompliantBook,
} from '../models/lorebook.model';
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
        if (
          archive['version'] !== undefined &&
          archive['version'] !== LORESTITCH_ARCHIVE_VERSION
        ) {
          return null;
        }
        if (!isProjectWorkspace(archive['workspace'])) {
          return null;
        }
        const workspace: ProjectWorkspace = archive['workspace'];
        return {
          format,
          workspace,
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
    const lines: string[] = [
      `# ${book.name ?? title} — Proofread Digest`,
      '',
      `${book.entries.length} entries · ~${estimateTokens(
        book.entries.map((e) => e.content).join('\n'),
      )} tokens (rough)`,
      '',
    ];

    const entries = [...book.entries]
      .filter((e) => includeDisabled || e.enabled)
      .sort((a, b) => a.insertion_order - b.insertion_order);

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
