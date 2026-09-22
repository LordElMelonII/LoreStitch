import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { MatBadgeModule } from '@angular/material/badge';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { WorkspaceService } from '../../../core/services/workspace.service';
import { LayoutService } from '../../../shared/services/layout.service';
import { ProjectActionsService } from '../project-actions.service';
import { cardExportRowState } from '../project-actions.constants';

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
 * Batch actions the swapped strip routes through the shell
 * (`App.runBatchBarAction` → the `EntryList` public API, Task 06 §3.2/§3.3).
 *
 * `export-selected` and `more-batch-actions` describe the two menu-looking
 * controls of the transplanted toolbar: `export-selected` is emitted directly
 * by the call_split button (the shell routes it to `EntryList.exportSelection`),
 * while `more-batch-actions` is NEVER emitted — the more_vert trigger opens
 * the bar's own batch menu in place (like the Export item above). The member
 * stays in the union (plan §3.2 fixes its shape) and the shell treats it as a
 * documented no-op.
 */
export type BatchBarAction =
  | 'batch-edit'
  | 'export-selected'
  | 'more-batch-actions'
  | 'duplicate-selection'
  | 'enable-selection'
  | 'disable-selection'
  | 'delete-selection'
  | 'select-all-shown'
  | 'clear-selection';

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
 * In `batch` (entries drawer open + a selection) the five quick actions are
 * replaced by five batch action items across the strip (`div.batch-bar[role=toolbar]`),
 * with a subtle tonal top edge on the host as the approved emphasis cue. The bar
 * is presentational here too: the toolbar and its menu only emit
 * `batchAction`; the shell routes every member to the `EntryList` public API
 * (`App.runBatchBarAction`).
 *
 * Selection-fact contract (inputs below): the shell reads the count and the
 * select-all tri-state off `EntryList`'s public signals and forwards them —
 * the bar holds no workspace/selection state of its own. The select-all button
 * emits `select-all-shown`; the shell resolves the boolean against the same
 * public tri-state facts (emit → shell handler is synchronous, so the
 * pre-tap fact is authoritative): when everything shown is already selected
 * the tap means deselect-shown, otherwise select-all-shown — the exact
 * behavior the drawer checkbox had, with the menu leaf (enabled only when
 * not-all-selected) reducing to the same rule.
 */
@Component({
  selector: 'app-mobile-bottom-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatBadgeModule, MatDividerModule, MatIconModule, MatMenuModule, MatTooltipModule],
  templateUrl: './mobile-bottom-bar.html',
  styleUrl: './mobile-bottom-bar.scss',
  host: {
    '[class.bar-hidden]': '!visible()',
    '[class.bar-backgrounded]': 'backgrounded()',
    '[class.bar-batch]': 'batched()',
  },
})
export class MobileBottomBar {
  private readonly layout = inject(LayoutService);
  protected readonly workspace = inject(WorkspaceService);
  protected readonly actions = inject(ProjectActionsService);

  /**
   * The strip's state, owned by the shell (`App.barState`): `normal` on the
   * idle phone surface, `backgrounded` while a drawer overlays the editor
   * (veiled + inert — the scrim look it cannot inherit), `batch` while the
   * entries drawer is open with an active selection (the transplanted
   * toolbar, fully interactive).
   */
  readonly barState = input<BarState>('normal');

  /**
   * Selection facts the shell mirrors off `EntryList`'s public API (Task 06
   * §3.3) for the batch strip: the rendered count, and the select-all
   * checkbox's tri-state sides. Meaningless outside `batch` (the toolbar
   * branch never renders them) but always kept live so the swap never shows
   * a stale count on the transition frames.
   */
  readonly selectionCount = input(0);
  readonly allShownSelected = input(false);
  readonly someShownSelected = input(false);

  /** Emits the triggered quick action; the shell routes it to its owner. */
  readonly action = output<MobileBarAction>();

  /** Emits the triggered batch action; the shell routes it to the
   * `EntryList` public API (see the class doc for the contract). */
  readonly batchAction = output<BatchBarAction>();

  /** Rendered only on phones with an open project — never unmounted by a
   * drawer or dialog (the always-docked contract; see the class doc). */
  protected readonly visible = computed(
    () => this.layout.isMobile() && this.workspace.activeProject() !== null,
  );

  /**
   * Card export row state (plan 15 §3.5) for the export menu's "Character
   * card" section — the same approved availability rules the topbar's rows
   * follow (shared `cardExportRowState`): unavailable without a card shell
   * (PNG additionally without stored image bytes), with the approved tooltip.
   */
  protected readonly cardPngRow = computed(() =>
    cardExportRowState(this.workspace.activeProject(), true),
  );

  protected readonly cardJsonRow = computed(() =>
    cardExportRowState(this.workspace.activeProject(), false),
  );

  /** Whether the strip is scrim-veiled and inert beneath an open drawer. */
  protected readonly backgrounded = computed(() => this.barState() === 'backgrounded');

  /** Whether the strip is foreground-swapped to the batch toolbar. */
  protected readonly batched = computed(() => this.barState() === 'batch');

  protected select(action: MobileBarAction): void {
    this.action.emit(action);
  }

  protected emitBatch(action: BatchBarAction): void {
    this.batchAction.emit(action);
  }

  /**
   * The select-all button's click handler: emits the bare member for both
   * toggle sides — the shell resolves the boolean from `EntryList`'s public
   * tri-state fact (see the class doc), which is synchronous to this emit
   * and therefore always the pre-tap state.
   */
  protected emitSelectAllChange(): void {
    this.batchAction.emit('select-all-shown');
  }
}
