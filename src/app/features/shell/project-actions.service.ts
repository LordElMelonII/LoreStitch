import { inject, Service } from '@angular/core';
import { BreakpointObserver } from '@angular/cdk/layout';
import { firstValueFrom } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ParsedImport, ImportExportService } from '../../core/services/import-export.service';
import { ProjectWorkspace } from '../../core/models/lorebook.model';
import { WorkspaceService } from '../../core/services/workspace.service';
import { MergeResolverDialog } from '../merge-resolver/merge-resolver-dialog';
import { type MergeOutcome } from '../merge-resolver/merge-resolver.model';
import { NewProjectDialog } from './new-project-dialog';
import { type NewProjectResult } from './new-project.model';
import { IMPORT_ACCEPT, MERGE_ACCEPT } from './project-actions.constants';
import { ConfirmDialog } from '../../shared/components/confirm-dialog/confirm-dialog';
import { MOBILE_BREAKPOINT_QUERY } from '../../shared/constants/breakpoints';

/**
 * Project lifecycle & import orchestration shared by the topbar and the
 * welcome screen: dialogs for create/delete, file picking, and merge.
 */
@Service()
export class ProjectActionsService {
  private readonly workspace = inject(WorkspaceService);
  private readonly dialog = inject(MatDialog);
  private readonly importer = inject(ImportExportService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly breakpoints = inject(BreakpointObserver);

  // -------------------------------------------------------------------------
  // Project lifecycle
  // -------------------------------------------------------------------------

  async newProject(): Promise<void> {
    const result = (await firstValueFrom(
      this.dialog.open(NewProjectDialog).afterClosed(),
    )) as NewProjectResult | undefined;
    if (result) {
      await this.workspace.createProject(result.title, result.targetType);
    }
  }

  async openProject(id: string): Promise<void> {
    await this.workspace.openProject(id);
  }

  async closeProject(): Promise<void> {
    await this.workspace.closeProject();
  }

  async deleteProject(project: ProjectWorkspace): Promise<void> {
    const confirmed = await firstValueFrom(
      this.dialog
        .open(ConfirmDialog, {
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

  private async importFile(file: File, mode: 'replace' | 'merge'): Promise<void> {
    let parsed: ParsedImport | null;
    try {
      parsed = this.importer.parseImport(JSON.parse(await file.text()), file.name);
    } catch {
      this.snackBar.open('Could not parse this file as JSON.', 'OK', { duration: 4000 });
      return;
    }
    if (!parsed) {
      this.snackBar.open(
        'Unsupported format — expected a lorebook, character card, SillyTavern world info, or .stproj file.',
        'OK',
        { duration: 5000 },
      );
      return;
    }

    if (mode === 'merge') {
      await this.openMergeDialog(parsed, file.name);
      return;
    }

    if (parsed.workspace) {
      await this.workspace.openImportedWorkspace(parsed.workspace);
      this.snackBar.open(`Opened project “${parsed.workspace.title}”.`, 'OK', { duration: 3500 });
      return;
    }

    await this.workspace.startProjectFromBook(
      parsed.suggestedTitle,
      parsed.book,
      parsed.card?.data,
    );
    this.snackBar.open(`Imported ${parsed.book.entries.length} entries from ${file.name}.`, 'OK', {
      duration: 3500,
    });
  }

  private async openMergeDialog(parsed: ParsedImport, fileName: string): Promise<void> {
    if (!this.workspace.activeProject()) {
      this.snackBar.open('Create or open a project before merging into it.', 'OK', {
        duration: 4000,
      });
      return;
    }
    const outcome = await firstValueFrom(
      this.dialog
        .open(MergeResolverDialog, {
          minWidth: 'min(94vw, 780px)',
          data: {
            incoming: parsed.book,
            sourceName: fileName,
            mode: this.breakpoints.isMatched(MOBILE_BREAKPOINT_QUERY) ? 'unified' : 'split',
          },
        })
        .afterClosed(),
    );
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
}
