import { Component, computed, inject, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatBadgeModule } from '@angular/material/badge';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ImportExportService } from '../../../core/services/import-export.service';
import { ThemeService } from '../../../core/services/theme.service';
import { WorkspaceService } from '../../../core/services/workspace.service';
import { SearchReplaceDialog } from '../../search-replace/search-replace-dialog';
import { ProjectActionsService } from '../project-actions.service';

/** Top app bar: brand, project actions, export/theme/project menus. */
@Component({
  selector: 'app-topbar',
  imports: [
    MatBadgeModule,
    MatButtonModule,
    MatDividerModule,
    MatIconModule,
    MatMenuModule,
    MatToolbarModule,
    MatTooltipModule,
  ],
  templateUrl: './topbar.html',
  styleUrl: './topbar.scss',
})
export class Topbar {
  protected readonly workspace = inject(WorkspaceService);
  protected readonly theme = inject(ThemeService);
  protected readonly actions = inject(ProjectActionsService);
  private readonly dialog = inject(MatDialog);
  private readonly importer = inject(ImportExportService);

  /** Drawer toggles, handled by the shell that owns the sidenav layout. */
  readonly toggleEntries = output<void>();
  readonly toggleHistory = output<void>();

  protected readonly projectName = computed(
    () => this.workspace.activeProject()?.title ?? 'LoreStitch',
  );

  protected openSearch(): void {
    this.dialog.open(SearchReplaceDialog, {
      maxWidth: 'min(96vw, 900px)',
      data: { activeEntryId: this.workspace.activeTabId() },
    });
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
}
