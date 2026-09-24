import { inject, Service } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { type MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import {
  ParsedImport,
  ImportExportService,
  type ExportResult,
} from '../../core/services/import-export.service';
import type { CharacterBook } from '../../core/models/lorebook.model';
import type { ProjectWorkspace } from '../../core/models/project.model';
import { validateBook } from '../../core/models/book-schema';
import { planBookRepair } from '../../core/models/book-repair';
import { WorkspaceService } from '../../core/services/workspace.service';
import { LayoutService } from '../../shared/services/layout.service';
import { ResponsiveOverlayService } from '../../shared/services/responsive-overlay.service';
import { type BookRepairDialogData } from '../../shared/components/book-repair-dialog/book-repair-dialog.model';
import { type MergeDialogData, type MergeOutcome } from '../merge-resolver/merge-resolver.model';
import { type ExportSelection } from '../merge-resolver/export-selected.model';
import { type ExportSelectedDialogData } from '../merge-resolver/export-selected-dialog';
import { type NewProjectResult } from './new-project.model';
import { CARD_FAILURE_COPY, IMPORT_ACCEPT, MERGE_ACCEPT } from './project-actions.constants';

/**
 * Awaits the result of a responsive pane whichever container opened it: the
 * two ref types carry no common completion stream, and both are the concrete
 * classes their containers construct (never wrapped or substituted), so a
 * prototype check reliably picks the matching one.
 */
export function paneResult<R>(
  ref: MatDialogRef<unknown, R> | MatBottomSheetRef<unknown, R>,
): Promise<R | undefined> {
  return firstValueFrom(ref instanceof MatDialogRef ? ref.afterClosed() : ref.afterDismissed());
}

/**
 * Project lifecycle & import orchestration shared by the topbar and the
 * welcome screen: dialogs for create/delete, file picking, and merge.
 *
 * Dialog components are loaded through dynamic imports so their code (and
 * the diff viewer pulled in by the merge resolver) stays out of the initial
 * bundle — they only run after an explicit user action. The merge resolver
 * and the export picker render as bottom sheets on phones via
 * `ResponsiveOverlayService`.
 */
@Service()
export class ProjectActionsService {
  private readonly workspace = inject(WorkspaceService);
  private readonly dialog = inject(MatDialog);
  private readonly overlays = inject(ResponsiveOverlayService);
  private readonly importer = inject(ImportExportService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly layout = inject(LayoutService);

  // -------------------------------------------------------------------------
  // Project lifecycle
  // -------------------------------------------------------------------------

  async newProject(): Promise<void> {
    const { NewProjectDialog } = await import('./new-project-dialog');
    const result = (await firstValueFrom(
      this.dialog
        .open(NewProjectDialog, {
          // Viewport-filling pane capped to the dialog's desktop measure; the
          // global class takes it full-screen below MD3's 600dp. Sizing here
          // replaces the component-level content width hack.
          width: '100%',
          maxWidth: 'min(96vw, 420px)',
          panelClass: 'app-compact-fullscreen-dialog',
        })
        .afterClosed(),
    )) as NewProjectResult | undefined;
    if (result) {
      await this.workspace.createProject(result.title);
    }
  }

  async openProject(id: string): Promise<void> {
    await this.workspace.openProject(id);
  }

  async closeProject(): Promise<void> {
    await this.workspace.closeProject();
  }

  async deleteProject(project: ProjectWorkspace): Promise<void> {
    const { ConfirmDialog } = await import('../../shared/components/confirm-dialog/confirm-dialog');
    const confirmed = await firstValueFrom(
      this.dialog
        .open(ConfirmDialog, {
          // MD3 adaptive behavior: the dialog goes full-screen on compact
          // screens (see the global .app-compact-fullscreen-dialog rules).
          panelClass: 'app-compact-fullscreen-dialog',
          data: {
            title: 'Delete project',
            message: `“${project.title}” and its commit history will be removed from this device. This cannot be undone.`,
            confirmLabel: 'Delete',
            danger: true,
          },
        })
        .afterClosed(),
    );
    if (confirmed) {
      await this.workspace.deleteProject(project.id);
    }
  }

  async deleteCurrentProject(): Promise<void> {
    const project = this.workspace.activeProject();
    if (project) {
      await this.deleteProject(project);
    }
  }

  // -------------------------------------------------------------------------
  // Import
  // -------------------------------------------------------------------------

  /** Opens a file picker and imports the chosen file, replacing the project. */
  async importReplaceFromPicker(): Promise<void> {
    const file = await this.pickFile(IMPORT_ACCEPT);
    if (file) {
      await this.importFile(file, 'replace');
    }
  }

  /** Opens a file picker and merges the chosen file into the current project. */
  async importMergeFromPicker(): Promise<void> {
    const file = await this.pickFile(MERGE_ACCEPT);
    if (file) {
      await this.importFile(file, 'merge');
    }
  }

  private async pickFile(accept: string): Promise<File | null> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.addEventListener('change', () => resolve(input.files?.[0] ?? null));
      input.addEventListener('cancel', () => resolve(null));
      input.click();
    });
  }

  /**
   * Reads the picked file and parses it (plan 15 §3.3). Card PNGs take the
   * bytes path — `JSON.parse` on image bytes is meaningless, and the base64
   * card payload must never round-trip through a text decode. Text files keep
   * today's flow: `JSON.parse` → `parseImport`, with the verbatim text riding
   * along so a card JSON opens at the card boundary when the lorebook sniff
   * fails all three shapes. Never throws: every failure snacks its approved
   * copy and returns `null`.
   */
  private async importFile(file: File, mode: 'replace' | 'merge'): Promise<void> {
    const parsed =
      /\.png$/i.test(file.name) || file.type === 'image/png'
        ? await this.parseCardPngImport(file)
        : await this.parseTextImport(file);
    if (!parsed) {
      return; // Failure feedback already shown.
    }

    if (mode === 'merge') {
      // The merge path offers the repair on the INCOMING book before the
      // cherry-picker opens (plan 09 §3.4) — the offer blocks the flow, and
      // "Import as-is" merges the original book verbatim.
      const incoming = await this.offerImportRepair(parsed.book, file.name);
      if (!incoming) {
        return; // Defensive hard block: nothing is imported.
      }
      await this.openMergeDialog({ ...parsed, book: incoming }, file.name);
      return;
    }

    if (parsed.workspace) {
      // `.stproj` archives keep their own path — the plan scopes the import
      // wiring to book imports (plan 09 §3.4).
      await this.workspace.openImportedWorkspace(parsed.workspace);
      this.snackBar.open(`Opened project “${parsed.workspace.title}”.`, 'OK', { duration: 3500 });
      return;
    }

    const book = await this.offerImportRepair(parsed.book, file.name);
    if (!book) {
      return; // Defensive hard block: nothing is imported.
    }
    await this.workspace.startProjectFromBook(parsed.suggestedTitle, book, parsed.cardShell);
    this.snackBar.open(
      parsed.cardShell
        ? `Imported ${book.entries.length} entries from character card ${file.name}.`
        : `Imported ${book.entries.length} entries from ${file.name}.`,
      'OK',
      { duration: 3500 },
    );
  }

  /**
   * Offers the guided repair for a parsed book BEFORE it enters the workspace
   * (plan 09 §3.4). Returns the book to import: the repaired copy on "Fix",
   * the original verbatim on "Import as-is" (a documented opt-in — the export
   * backstop re-offers the repair at the door), and `null` after the
   * defensive hard-block when defects admit no repair (unreachable after the
   * import guards and `normalizeImportedBook`, but such a book imports
   * nothing). A clean book passes straight through — no dialog, zero overhead
   * (the never-false-positive pin, plan 09 §7.1).
   */
  private async offerImportRepair(book: CharacterBook, fileName: string): Promise<CharacterBook | null> {
    const defects = validateBook(book);
    if (defects.length === 0) {
      return book;
    }
    const repair = planBookRepair(book, defects);
    const fix = await this.openRepairDialog({
      context: 'import',
      repair,
      defects,
      bookTitle: book.name || fileName,
    });
    if (!repair) {
      return null; // No automatic fix exists — import nothing.
    }
    return fix ? repair.book : book;
  }

  /**
   * Surfaces a failed export's pre-flight result (plan 09 §3.5): fixable
   * defects open the guided repair dialog (context 'export') and the result
   * reports the user's consent; unfixable ones open the hard block listing
   * the defects, with the snapshot attribution when present. Returns true
   * only when the user consented to a repair plan — the caller then applies
   * it and re-runs the same export.
   */
  private async offerExportRepair(
    result: Extract<ExportResult, { ok: false }>,
    bookTitle: string,
  ): Promise<boolean> {
    return this.openRepairDialog({
      context: 'export',
      repair: result.repair,
      defects: result.defects,
      source: result.source,
      bookTitle,
    });
  }

  /**
   * Opens the guided repair pane through the responsive overlay — dialog on
   * tablet/desktop, bottom sheet on phones — and resolves its boolean result
   * (truthy only on the repair consent, the ConfirmDialog contract).
   */
  private async openRepairDialog(data: BookRepairDialogData): Promise<boolean> {
    const { BookRepairDialog } = await import(
      '../../shared/components/book-repair-dialog/book-repair-dialog'
    );
    const ref = this.overlays.openResponsive<
      InstanceType<typeof BookRepairDialog>,
      BookRepairDialogData,
      boolean
    >(BookRepairDialog, {
      data,
      dialog: {
        width: '100%',
        maxWidth: 'min(540px, calc(100vw - 96px))',
        panelClass: 'app-repair-dialog',
        ariaLabel: 'Book repair',
      },
      sheetPanelClass: 'app-repair-sheet',
      sheetConfig: { ariaLabel: 'Book repair' },
    });
    return (await paneResult(ref)) === true;
  }

  /** PNG card path: bytes → card boundary; a refusal snacks its approved copy. */
  private async parseCardPngImport(file: File): Promise<ParsedImport | null> {
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch {
      this.snackBar.open('Could not parse this file as JSON.', 'OK', { duration: 4000 });
      return null;
    }
    const card = this.importer.parseCardImport({ pngBytes: bytes }, file.name);
    if (card.status === 'card-error') {
      this.snackBar.open(CARD_FAILURE_COPY[card.error.reason], 'OK', { duration: 5000 });
      return null;
    }
    return card.parsed;
  }

  /**
   * Today's text flow, extended with the card boundary (plan 15 §3.3): a
   * sniff-failed payload that is a card opens through `parseCardImport`; one
   * that is neither reports the card reason (checkpoint 15-1 copy) so every
   * unrecognized text file says what it was expected to be.
   */
  private async parseTextImport(file: File): Promise<ParsedImport | null> {
    let text: string;
    try {
      text = await file.text();
    } catch {
      this.snackBar.open('Could not parse this file as JSON.', 'OK', { duration: 4000 });
      return null;
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      this.snackBar.open('Could not parse this file as JSON.', 'OK', { duration: 4000 });
      return null;
    }
    const parsed = this.importer.parseImport(json, file.name, { rawText: text });
    if (parsed) {
      return parsed;
    }
    // The lorebook sniff failed and the card boundary refused the payload:
    // recover the card reason for the approved copy (the open re-runs only on
    // this failure path).
    const card = this.importer.parseCardImport({ rawText: text }, file.name);
    if (card.status === 'card-error') {
      this.snackBar.open(CARD_FAILURE_COPY[card.error.reason], 'OK', { duration: 5000 });
      return null;
    }
    this.snackBar.open(
      'Unsupported format — expected a lorebook, SillyTavern world info, or .stproj file.',
      'OK',
      { duration: 5000 },
    );
    return null;
  }

  private async openMergeDialog(parsed: ParsedImport, fileName: string): Promise<void> {
    if (!this.workspace.activeProject()) {
      this.snackBar.open('Create or open a project before merging into it.', 'OK', {
        duration: 4000,
      });
      return;
    }
    const { MergeResolverDialog } = await import('../merge-resolver/merge-resolver-dialog');
    const ref = this.overlays.openResponsive<
      InstanceType<typeof MergeResolverDialog>,
      MergeDialogData,
      MergeOutcome | null
    >(MergeResolverDialog, {
      data: {
        incoming: parsed.book,
        sourceName: fileName,
        // Phone widths cannot fit a side-by-side diff.
        mode: this.layout.isMobile() ? 'unified' : 'split',
      },
      // Tablet/desktop config, identical to the former dialog.open() call.
      dialog: {
        minWidth: 'min(94vw, 780px)',
        // MD3 adaptive behavior: the dialog goes full-screen on compact
        // screens (see the global .app-compact-fullscreen-dialog rules).
        panelClass: 'app-compact-fullscreen-dialog',
      },
      sheetPanelClass: 'app-merge-sheet',
      sheetConfig: { ariaLabel: 'Merge lorebook' },
    });
    const outcome = await paneResult(ref);
    if (!outcome) {
      return;
    }
    this.applyMergeOutcome(outcome);
  }

  private applyMergeOutcome(outcome: MergeOutcome): void {
    const project = this.workspace.activeProject();
    if (!project) {
      return;
    }
    this.workspace.replaceBook({ ...project.activeBook, entries: outcome.entries });
    this.snackBar.open(
      `Merged: ${outcome.imported} new, ${outcome.overwritten} overwritten, ${outcome.skipped} skipped.`,
      'OK',
      { duration: 4500 },
    );
  }

  // -------------------------------------------------------------------------
  // Splitting (export selected entries)
  // -------------------------------------------------------------------------

  /**
   * "Export Selected Entries as Lorebook": opens the picker dialog and
   * downloads the selection as a standalone lorebook file. `preselectedIds`
   * seeds the dialog from the sidebar's batch selection.
   */
  async exportSelectedEntries(preselectedIds: number[] = []): Promise<void> {
    if (!this.workspace.activeProject()) {
      this.snackBar.open('Create or open a project before exporting.', 'OK', { duration: 4000 });
      return;
    }
    const { ExportSelectedDialog } = await import('../merge-resolver/export-selected-dialog');
    const ref = this.overlays.openResponsive<
      InstanceType<typeof ExportSelectedDialog>,
      ExportSelectedDialogData,
      ExportSelection | null
    >(ExportSelectedDialog, {
      data: { preselectedIds } satisfies ExportSelectedDialogData,
      // Tablet/desktop config, identical to the former dialog.open() call.
      dialog: {
        width: '100%',
        maxWidth: 'min(96vw, 680px)',
        // MD3 adaptive behavior: the dialog goes full-screen on compact
        // screens (see the global .app-compact-fullscreen-dialog rules).
        panelClass: 'app-compact-fullscreen-dialog',
      },
      sheetPanelClass: 'app-export-sheet',
      sheetConfig: { ariaLabel: 'Export selected entries as lorebook' },
    });
    const selection = await paneResult(ref);
    if (!selection) {
      return;
    }

    // Each run re-reads the fresh activeBook (and bails when the project
    // disappeared while the dialog was open) so the post-repair retry
    // exports the repaired tree (plan 09 §3.5).
    const runSplit = (): ExportResult | null => {
      const current = this.workspace.activeProject();
      if (!current) {
        return null;
      }
      return this.importer.exportSelectedBook(
        current.activeBook,
        selection.entryIds,
        selection.title,
        selection.format,
      );
    };
    const announce = (): void => {
      this.snackBar.open(
        `Exported ${selection.entryIds.length} entries as “${selection.title}”.`,
        'OK',
        { duration: 4000 },
      );
    };

    const result = runSplit();
    if (result === null || result.ok) {
      if (result !== null) {
        announce();
      }
      return;
    }

    // The split repair is planned over the SUB-book (that is what the export
    // writes) while the workspace holds the parent. On consent, fold the fix
    // back onto the mapped parent entries through the workspace mutator, then
    // re-run the same export — it re-validates clean and downloads.
    const consented = await this.offerExportRepair(result, selection.title);
    if (!consented || !result.repair) {
      return; // Declined or hard block: no download, nothing else.
    }
    this.workspace.applyBookRepair(result.repair, selection.entryIds);
    const retry = runSplit();
    if (retry !== null && retry.ok) {
      announce();
    }
  }

  // -------------------------------------------------------------------------
  // Export (whole project, fixed formats)
  // -------------------------------------------------------------------------

  /**
   * The fixed-format export wrappers live here (the topbar's Export menu and
   * the mobile bottom bar's Export menu both call them, and the two card
   * exports with them) — the logic exists exactly once; the menus only wire
   * items to these methods. Card failures snack the approved copy table
   * (`project-actions.constants.ts`). Each book-carrying export consumes the
   * importer's pre-flight `ExportResult` (plan 09 §3.5): a fixable book opens
   * the guided repair dialog — consent applies the plan through the workspace
   * mutator and re-runs the same export on the repaired tree (it re-reads the
   * fresh activeBook, re-validates clean and downloads); declining downloads
   * nothing and says nothing more (the approved copy has no extra snackbar).
   * An unfixable book opens the hard block instead. Nothing is ever
   * downloaded while the book is defective — the importer guarantees the
   * no-download half by returning before any byte is written.
   */
  async exportStNative(): Promise<void> {
    const project = this.workspace.activeProject();
    if (!project) {
      return;
    }
    const result = this.importer.exportStNative(project.activeBook, project.title);
    if (result.ok) {
      return;
    }
    const consented = await this.offerExportRepair(result, project.title);
    if (!consented || !result.repair) {
      return;
    }
    this.workspace.applyBookRepair(result.repair);
    await this.exportStNative();
  }

  /** ".stproj" archive: full backup including commit history. */
  async exportProjectArchive(): Promise<void> {
    const project = this.workspace.activeProject();
    if (!project) {
      return;
    }
    const result = this.importer.exportProject(project);
    if (result.ok) {
      return;
    }
    const consented = await this.offerExportRepair(result, project.title);
    if (!consented || !result.repair) {
      return;
    }
    // Only an activeBook block can carry a plan (a defective snapshot
    // hard-blocks with `repair: null`); the re-run validates the snapshots
    // again — untouched — and then the repaired activeBook.
    this.workspace.applyBookRepair(result.repair);
    await this.exportProjectArchive();
  }

  /** "Character Book JSON": standard V2 spec for cards and third-party tools. */
  async exportBook(): Promise<void> {
    const project = this.workspace.activeProject();
    if (!project) {
      return;
    }
    const result = this.importer.exportCharacterBook(project.activeBook, project.title);
    if (result.ok) {
      return;
    }
    const consented = await this.offerExportRepair(result, project.title);
    if (!consented || !result.repair) {
      return;
    }
    this.workspace.applyBookRepair(result.repair);
    await this.exportBook();
  }

  /** Markdown digest of every entry, for proofreading outside the app. */
  exportDigest(): void {
    const project = this.workspace.activeProject();
    if (project) {
      this.importer.exportMarkdownDigest(project.activeBook, project.title);
    }
  }

  /**
   * "Character card (PNG)": re-embeds the edited book into the original card
   * image (plan 15 §3.4). Unavailable shells refuse here — the same approved
   * copy the disabled menu row's tooltip carries — so a keyboard or touch
   * trigger still explains itself instead of erroring (plan 15 §3.5: no
   * card fabrication, no dialog).
   */
  exportCardPng(): void {
    const project = this.workspace.activeProject();
    if (!project) {
      return;
    }
    const failure = this.importer.exportCardPng(project);
    if (failure) {
      this.snackBar.open(CARD_FAILURE_COPY[failure.reason], 'OK', { duration: 5000 });
    }
  }

  /** "Character card (JSON)": swaps the edited book into the card JSON. */
  exportCardJson(): void {
    const project = this.workspace.activeProject();
    if (!project) {
      return;
    }
    const failure = this.importer.exportCardJson(project);
    if (failure) {
      this.snackBar.open(CARD_FAILURE_COPY[failure.reason], 'OK', { duration: 5000 });
    }
  }

  // -------------------------------------------------------------------------
  // Entry creation (mobile shell trigger)
  // -------------------------------------------------------------------------

  /**
   * Appends a new entry to the active book. Thin wrapper over the workspace
   * so the mobile shell (topbar button, bottom bar) can start an entry
   * without reaching into the sidebar component; the sidebar reveals/scrolls
   * to the appended row through its own append-tracking effect.
   */
  createEntry(): void {
    this.workspace.addEntry();
  }
}
