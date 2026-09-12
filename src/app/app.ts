import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { BreakpointObserver } from '@angular/cdk/layout';
import { toSignal } from '@angular/core/rxjs-interop';
import { firstValueFrom, map } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';
import { MatListModule } from '@angular/material/list';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatBadgeModule } from '@angular/material/badge';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ParsedImport, ImportExportService } from './core/services/import-export.service';
import { ProjectWorkspace } from './core/models/lorebook.model';
import { ThemeService } from './core/services/theme.service';
import { WorkspaceService } from './core/services/workspace.service';
import { EntryList } from './features/entry-list/entry-list';
import { EntryEditor } from './features/entry-editor/entry-editor';
import { CommitHistory } from './features/commit-history/commit-history';
import { SearchReplaceDialog } from './features/search-replace/search-replace-dialog';
import { MergeOutcome, MergeResolverDialog } from './features/merge-resolver/merge-resolver-dialog';
import { NewProjectDialog } from './features/shell/new-project-dialog';
import { ConfirmDialog } from './shared/components/confirm-dialog/confirm-dialog';

/** Studio shell: entry sidenav, tabbed editor, commit history drawer. */
@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatMenuModule,
    MatDividerModule,
    MatListModule,
    MatSidenavModule,
    MatToolbarModule,
    MatTooltipModule,
    MatBadgeModule,
    EntryList,
    EntryEditor,
    CommitHistory,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly workspace = inject(WorkspaceService);
  protected readonly theme = inject(ThemeService);
  private readonly dialog = inject(MatDialog);
  private readonly importer = inject(ImportExportService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly breakpoints = inject(BreakpointObserver);

  protected readonly isMobile = toSignal(
    this.breakpoints.observe('(max-width: 767px)').pipe(map((r) => r.matches)),
    { initialValue: false },
  );

  protected readonly leftOpened = signal(true);
  protected readonly rightOpened = signal(true);

  constructor() {
    effect(() => {
      if (this.isMobile()) {
        this.leftOpened.set(false);
        this.rightOpened.set(false);
      } else {
        this.leftOpened.set(true);
        this.rightOpened.set(true);
      }
    });
  }

  protected readonly projectName = computed(
    () => this.workspace.activeProject()?.title ?? 'LoreStitch',
  );

  protected readonly projectCount = computed(() => this.workspace.savedProjects().length);

  // -------------------------------------------------------------------------
  // Project actions
  // -------------------------------------------------------------------------

  protected async newProject(): Promise<void> {
    const result = (await firstValueFrom(this.dialog.open(NewProjectDialog).afterClosed())) as
      { title: string; targetType: ProjectWorkspace['targetType'] } | undefined;
    if (result) {
      await this.workspace.createProject(result.title, result.targetType);
    }
  }

  protected async openProject(id: string): Promise<void> {
    await this.workspace.openProject(id);
  }

  protected async closeProject(): Promise<void> {
    await this.workspace.closeProject();
  }

  protected async deleteProject(project: ProjectWorkspace, event?: Event): Promise<void> {
    event?.stopPropagation();
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

  protected async deleteCurrentProject(): Promise<void> {
    const project = this.workspace.activeProject();
    if (project) {
      await this.deleteProject(project);
    }
  }

  // -------------------------------------------------------------------------
  // Import
  // -------------------------------------------------------------------------

  protected async onImportFile(event: Event, mode: 'replace' | 'merge'): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // allow re-selecting the same file
    if (!file) {
      return;
    }

    let parsed: ParsedImport | null = null;
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
            mode: this.isMobile() ? 'unified' : 'split',
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

  // -------------------------------------------------------------------------
  // Export
  // -------------------------------------------------------------------------

  protected exportBook(): void {
    const project = this.workspace.activeProject();
    if (project) {
      this.importer.exportCharacterBook(project.activeBook, project.title);
    }
  }

  protected exportStNative(): void {
    const project = this.workspace.activeProject();
    if (project) {
      this.importer.exportStNative(project.activeBook, project.title);
    }
  }

  protected exportCard(): void {
    const project = this.workspace.activeProject();
    if (project) {
      this.importer.exportTavernCard(project);
    }
  }

  protected exportProjectArchive(): void {
    const project = this.workspace.activeProject();
    if (project) {
      this.importer.exportProject(project);
    }
  }

  protected exportDigest(): void {
    const project = this.workspace.activeProject();
    if (project) {
      this.importer.exportMarkdownDigest(project.activeBook, project.title);
    }
  }

  // -------------------------------------------------------------------------
  // Dialogs & drawer toggles
  // -------------------------------------------------------------------------

  protected openSearch(): void {
    this.dialog.open(SearchReplaceDialog, {
      maxWidth: 'min(96vw, 900px)',
      data: { activeEntryId: this.workspace.activeTabId() },
    });
  }

  protected toggleLeft(): void {
    this.leftOpened.update((v) => !v);
  }

  protected toggleRight(): void {
    this.rightOpened.update((v) => !v);
  }

  protected closeLeft(): void {
    this.leftOpened.set(false);
  }

  protected closeRight(): void {
    this.rightOpened.set(false);
  }
}
