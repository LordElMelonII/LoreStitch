import { Component, computed, inject, output } from '@angular/core';
import { BreakpointObserver } from '@angular/cdk/layout';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
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
import { GITHUB_REPO_URL } from '../../../shared/constants/github';
import { DESKTOP_BREAKPOINT_QUERY } from '../../../shared/constants/breakpoints';
import { LayoutService } from '../../../shared/services/layout.service';
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
  protected readonly layout = inject(LayoutService);
  protected readonly actions = inject(ProjectActionsService);
  private readonly dialog = inject(MatDialog);
  private readonly importer = inject(ImportExportService);
  private readonly breakpoints = inject(BreakpointObserver);

  /** Drawer toggles, handled by the shell that owns the sidenav layout. */
  readonly toggleEntries = output<void>();
  readonly toggleHistory = output<void>();

  /**
   * Focus mode exists only where the constrained width has room to center
   * in: desktop viewports. The toggle button is hidden below 1280px.
   */
  protected readonly isDesktop = toSignal(
    this.breakpoints.observe(DESKTOP_BREAKPOINT_QUERY).pipe(map((r) => r.matches)),
    { initialValue: false },
  );

  protected readonly projectName = computed(
    () => this.workspace.activeProject()?.title ?? 'LoreStitch',
  );

  /** External repository link (top bar on the welcome screen, More menu otherwise). */
  protected readonly githubUrl = GITHUB_REPO_URL;

  protected async openSearch(): Promise<void> {
    // Lazy-loaded: keeps the search/replace UI out of the initial bundle.
    const { SearchReplaceDialog } = await import('../../search-replace/search-replace-dialog');
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
