import { Service } from '@angular/core';
import {
  CharacterBook,
  LoreFileFormat,
  ProjectWorkspace,
  SillyTavernWorldInfo,
  characterBookToStNative,
  detectLoreFileFormat,
  entryTitle,
  estimateTokens,
  normalizeBookPositions,
  stNativeToCharacterBook,
  toSpecCompliantBook,
} from '../models/lorebook.model';

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
  /** Reads a `File` as text (imports are JSON only). */
  async readFileText(file: File): Promise<string> {
    return file.text();
  }

  /**
   * Parses imported JSON and auto-detects its format: a bare
   * `CharacterBook`, a LoreStitch `.stproj` archive, or a native SillyTavern
   * world-info export.
   */
  parseImport(json: unknown, fallbackTitle = 'Imported Lorebook'): ParsedImport | null {
    const format = detectLoreFileFormat(json);
    if (!format) {
      return null;
    }

    switch (format) {
      case 'sillytavern_native': {
        const book = stNativeToCharacterBook(json as SillyTavernWorldInfo, fallbackTitle);
        return {
          format,
          book,
          suggestedTitle: book.name || fallbackTitle,
        };
      }
      case 'stproj': {
        const wrapper = json as { workspace: ProjectWorkspace };
        return {
          format,
          workspace: wrapper.workspace,
          book: wrapper.workspace.activeBook,
          suggestedTitle: wrapper.workspace.title || fallbackTitle,
        };
      }
      default: {
        const book = normalizeBookPositions(structuredClone(json as CharacterBook));
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

  /** Full project archive including the commit history. */
  exportProject(project: ProjectWorkspace): void {
    const archive = {
      format: 'lorestitch-project' as const,
      version: 1,
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
    const anchor = document.createElement('a');
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
