import { Component, computed, inject, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatBadgeModule } from '@angular/material/badge';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ThemeService } from '../../../core/services/theme.service';
import { WorkspaceService } from '../../../core/services/workspace.service';
import { GITHUB_REPO_URL } from '../../../shared/constants/github';
import { TouchSafeNestedMenuTrigger } from '../../../shared/directives/touch-safe-nested-menu-trigger';
import { LayoutService } from '../../../shared/services/layout.service';
import { ResponsiveOverlayService } from '../../../shared/services/responsive-overlay.service';
import { LinterState } from '../../linter/linter-state';
import { ProjectActionsService } from '../project-actions.service';
import { cardExportRowState } from '../project-actions.constants';
import { TokenMeter } from './token-meter';

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
    TokenMeter,
    TouchSafeNestedMenuTrigger,
  ],
  templateUrl: './topbar.html',
  styleUrl: './topbar.scss',
})
export class Topbar {
  protected readonly workspace = inject(WorkspaceService);
  protected readonly theme = inject(ThemeService);
  protected readonly layout = inject(LayoutService);
  protected readonly actions = inject(ProjectActionsService);
  protected readonly linter = inject(LinterState);
  private readonly dialog = inject(MatDialog);
  private readonly overlay = inject(ResponsiveOverlayService);

  /** Drawer toggles, handled by the shell that owns the sidenav layout. */
  readonly toggleEntries = output<void>();
  readonly toggleHistory = output<void>();

  /**
   * Focus mode exists only where the constrained width has room to center
   * in: desktop viewports. The toggle button is hidden below 1280px. Owned
   * by `LayoutService` (the single source of viewport truth).
   */
  protected readonly isDesktop = this.layout.isDesktop;

  protected readonly projectName = computed(
    () => this.workspace.activeProject()?.title ?? 'LoreStitch',
  );

  /** External repository link (top bar on the welcome screen, More menu otherwise). */
  protected readonly githubUrl = GITHUB_REPO_URL;

  /**
   * Opens global search & replace seeded with the active entry (null when no
   * entry is open — the dialog then defaults to its "All entries" scope).
   * Public: the shell forwards the mobile bottom bar's Search & replace
   * action here through `viewChild`, keeping this dialog config the single
   * source of truth for every trigger (topbar buttons and the bar alike).
   */
  async openSearch(): Promise<void> {
    // Lazy-loaded: keeps the search/replace UI out of the initial bundle.
    const { SearchReplaceDialog } = await import('../../search-replace/search-replace-dialog');
    this.dialog.open(SearchReplaceDialog, {
      // Full-width pane capped to the body's desktop measure; the compact
      // class turns the pane edge-to-edge full-screen under 600px.
      width: '100%',
      maxWidth: 'min(96vw, 640px)',
      panelClass: 'app-compact-fullscreen-dialog',
      data: { activeEntryId: this.workspace.activeTabId() },
    });
  }

  /**
   * Health check pane: centered dialog on tablet/desktop, bottom sheet on
   * phones — same content component, adapted per the mobile ergonomics
   * charter. The viewport branching lives in `ResponsiveOverlayService`; the
   * pane reads the root-provided `LinterState`, so no data is passed and the
   * badge and the pane can never disagree about the book's health.
   */
  protected async openLinter(): Promise<void> {
    // Lazy-loaded: the health check pane is only paid for when actually opened.
    const { LinterDialog } = await import('../../linter/linter-dialog');
    this.overlay.openResponsive(LinterDialog, {
      dialog: {
        width: '100%',
        maxWidth: 'min(94vw, 720px)',
        panelClass: 'app-linter-dialog',
        ariaLabel: 'Lorebook health check',
      },
      sheetPanelClass: 'app-linter-sheet',
      sheetConfig: { ariaLabel: 'Lorebook health check' },
    });
  }

  /**
   * About pane: centered dialog on tablet/desktop, bottom sheet on phones —
   * same content component, adapted per the mobile ergonomics charter. The
   * viewport branching lives in `ResponsiveOverlayService`.
   */
  protected async openAbout(): Promise<void> {
    // Lazy-loaded: the About bundle (tabs, changelog, credits) is only paid
    // for when actually opened.
    const { AboutDialog } = await import('../../about/about-dialog');
    this.overlay.openResponsive(AboutDialog, {
      dialog: {
        width: '100%',
        maxWidth: 'min(94vw, 680px)',
        panelClass: 'app-about-dialog',
      },
      sheetPanelClass: 'app-about-sheet',
    });
  }

  // -------------------------------------------------------------------------
  // Export
  // -------------------------------------------------------------------------
  // The fixed-format export wrappers live on `ProjectActionsService`
  // (`actions.exportStNative/exportProjectArchive/exportBook/exportDigest`
  // plus the two card exports) — the mobile bottom bar's Export menu calls
  // the very same methods, so the logic exists exactly once. This template
  // only wires menu items to them.

  /**
   * Card export row state (plan 15 §3.5): the two "Character card" rows are
   * disabled without a card shell (PNG additionally without stored image
   * bytes) and carry the approved tooltip explaining why. Derived from the
   * active project's `cardShell` via signals only; the disabled look is
   * inert-with-tooltip, because Material tooltips never fire on truly
   * disabled buttons (checkpoint 15-1 discovery) and the wrapper click-guard
   * snacks the same copy when a disabled row is still triggered.
   */
  protected readonly cardPngRow = computed(() =>
    cardExportRowState(this.workspace.activeProject(), true),
  );

  protected readonly cardJsonRow = computed(() =>
    cardExportRowState(this.workspace.activeProject(), false),
  );
}
