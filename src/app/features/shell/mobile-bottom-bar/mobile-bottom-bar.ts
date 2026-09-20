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
 * What the phone strip is doing beneath whatever else is open. `batch` is
 * the entry-list selection swap (Task 06 P2): it ships in the union from
 * the start so the shell/bar contract does not change shape twice — P1
 * never receives it, and the bar renders nothing for it yet.
 */
export type BarState = 'normal' | 'backgrounded' | 'batch';

/**
 * M3 bottom action bar for phones: the quick actions that desktop reaches
 * through topbar buttons and keyboard shortcuts, docked to the viewport's
 * bottom edge as a normal flex child of the shell — never fixed-positioned,
 * so the workspace shrinks above it and nothing can ever overlap editor
 * content (the overlap bug that retired the mobile FAB).
 *
 * Always docked while a phone session has a project: tearing the 64px row
 * down and rebuilding it on every drawer/dialog open read as a stutter, so
 * nothing unstamps the bar anymore. What covers it differs by kind — an
 * over-mode drawer's scrim stops at the sidenav container above, so the
 * shell lowers the bar to `backgrounded` and the bar synthesizes the scrim
 * look itself (veil + inert content); full-viewport CDK overlays (dialogs,
 * sheets, menus) simply cover and dim the strip, so they carry no bar-side
 * state at all.
 *
 * Presentational by design: it renders its state and emits `action`; the
 * shell (`App`) routes each action to the owning component or service and
 * computes the `barState` it feeds back.
 */
@Component({
  selector: 'app-mobile-bottom-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatBadgeModule, MatDividerModule, MatIconModule, MatMenuModule],
  templateUrl: './mobile-bottom-bar.html',
  styleUrl: './mobile-bottom-bar.scss',
  host: {
    '[class.bar-hidden]': '!visible()',
    '[class.bar-backgrounded]': 'backgrounded()',
  },
})
export class MobileBottomBar {
  private readonly layout = inject(LayoutService);
  protected readonly workspace = inject(WorkspaceService);
  protected readonly actions = inject(ProjectActionsService);

  /**
   * The strip's state, owned by the shell (`App.barState`): `normal` on the
   * idle phone surface, `backgrounded` while a drawer overlays the editor
   * (veiled + inert — the scrim look it cannot inherit), `batch` once the
   * P2 selection swap lands (fully interactive).
   */
  readonly barState = input<BarState>('normal');

  /** Emits the triggered quick action; the shell routes it to its owner. */
  readonly action = output<MobileBarAction>();

  /** Rendered only on phones with an open project — never unmounted by a
   * drawer or dialog (the always-docked contract; see the class doc). */
  protected readonly visible = computed(
    () => this.layout.isMobile() && this.workspace.activeProject() !== null,
  );

  /** Whether the strip is scrim-veiled and inert beneath an open drawer. */
  protected readonly backgrounded = computed(() => this.barState() === 'backgrounded');

  protected select(action: MobileBarAction): void {
    this.action.emit(action);
  }
}
