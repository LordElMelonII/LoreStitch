import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { MatBadgeModule } from '@angular/material/badge';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { WorkspaceService } from '../../../core/services/workspace.service';
import { LayoutService } from '../../../shared/services/layout.service';
import { ProjectActionsService } from '../project-actions.service';

/**
 * Quick actions the bar routes through the shell (`App.runBarAction`).
 *
 * `export` is deliberately absent: the bar's Export item is a menu trigger
 * over the shared five-entry export menu (see the template), whose entries
 * call `ProjectActionsService` directly — nothing is routed through the
 * shell for it, so a union member would only ever be a dead switch case.
 */
export type MobileBarAction = 'new-entry' | 'search-replace' | 'batch' | 'history';

/**
 * M3 bottom action bar for phones: the quick actions that desktop reaches
 * through topbar buttons and keyboard shortcuts, docked to the viewport's
 * bottom edge as a normal flex child of the shell — never fixed-positioned,
 * so the workspace shrinks above it and nothing can ever overlap editor
 * content (the overlap bug that retired the mobile FAB).
 *
 * Presentational by design: it renders, hides and emits `action`; the shell
 * (`App`) routes each action to the owning component or service and feeds
 * drawer and overlay state back through inputs.
 */
@Component({
  selector: 'app-mobile-bottom-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatBadgeModule, MatDividerModule, MatIconModule, MatMenuModule],
  templateUrl: './mobile-bottom-bar.html',
  styleUrl: './mobile-bottom-bar.scss',
  host: {
    '[class.bar-hidden]': '!visible()',
  },
})
export class MobileBottomBar {
  private readonly layout = inject(LayoutService);
  protected readonly workspace = inject(WorkspaceService);
  protected readonly actions = inject(ProjectActionsService);

  /**
   * True while any dialog or bottom sheet covers the app. The bar hides for
   * as long as a modal pane is up (it re-appears when all close), so it
   * never sits beneath a scrim or fights a sheet for the bottom edge.
   */
  readonly overlayOpen = input(false);

  /**
   * True while either sidenav drawer is open. Unlike overlays, an over-mode
   * drawer's scrim cannot cover the bar (it lives outside the sidenav
   * container), so the bar hides itself instead of showing UI that looks
   * reachable but is not.
   */
  readonly drawerOpen = input(false);

  /** Emits the triggered quick action; the shell routes it to its owner. */
  readonly action = output<MobileBarAction>();

  /** Rendered only on phones with an open project and nothing covering it. */
  protected readonly visible = computed(
    () =>
      this.layout.isMobile() &&
      this.workspace.activeProject() !== null &&
      !this.overlayOpen() &&
      !this.drawerOpen(),
  );

  protected select(action: MobileBarAction): void {
    this.action.emit(action);
  }
}
