import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { WorkspaceService } from '../../../core/services/workspace.service';
import { LayoutService } from '../../../shared/services/layout.service';

/** Quick actions the mobile FAB exposes, in stack order. */
export type MobileFabAction = 'new-entry' | 'search-replace' | 'export' | 'batch';

/** One row of the expanded stack: small FAB + visible label. */
interface MobileFabActionRow {
  readonly id: MobileFabAction;
  readonly label: string;
  readonly icon: string;
}

/**
 * The stack contents. Icons reuse glyphs already in the subsetted Material
 * Symbols font (see src/styles.scss) and match the sidebar/topbar icons for
 * the same operations, so the FAB never teaches a second symbol per action.
 */
const MOBILE_FAB_ACTIONS: readonly MobileFabActionRow[] = [
  { id: 'new-entry', label: 'New entry', icon: 'post_add' },
  { id: 'search-replace', label: 'Search & replace', icon: 'find_replace' },
  { id: 'export', label: 'Export entries', icon: 'call_split' },
  { id: 'batch', label: 'Batch edit', icon: 'checklist' },
];

/**
 * Collapsible bottom-end FAB for phones: the quick actions that desktop
 * reaches through topbar buttons and keyboard shortcuts. Presentational by
 * design — it renders, expands and emits `action`; the shell (App) routes
 * each action to the owning component or service and feeds back drawer and
 * overlay state through inputs.
 */
@Component({
  selector: 'app-mobile-fab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatIconModule],
  templateUrl: './mobile-fab.html',
  styleUrl: './mobile-fab.scss',
  host: {
    '[class.fab-hidden]': '!visible()',
    '[class.fab-expanded]': 'expanded()',
    '(document:keydown.escape)': 'collapseOnEscape()',
  },
})
export class MobileFab {
  private readonly layout = inject(LayoutService);
  private readonly workspace = inject(WorkspaceService);

  /**
   * True while any dialog or bottom sheet covers the app. The whole FAB
   * hides for as long as a modal pane is up (it re-appears when all close),
   * so it never floats over a scrim or fights a sheet for the bottom edge.
   */
  readonly overlayOpen = input(false);

  /**
   * True while either sidenav drawer is open. Unlike overlays, drawers keep
   * the collapsed FAB visible — only the expanded stack folds away.
   */
  readonly drawerOpen = input(false);

  /** Emits the triggered quick action; the shell routes it to its owner. */
  readonly action = output<MobileFabAction>();

  protected readonly actions = MOBILE_FAB_ACTIONS;

  protected readonly expanded = signal(false);

  /** Rendered only on phones with an open project and no modal pane above. */
  protected readonly visible = computed(
    () => this.layout.isMobile() && this.workspace.activeProject() !== null && !this.overlayOpen(),
  );

  constructor() {
    // The stack never outlives its context: a drawer or overlay opening, the
    // viewport leaving the phone class, or the project closing all fold it
    // first, so a stale expanded menu can never reappear later.
    effect(() => {
      if (this.drawerOpen() || this.overlayOpen() || !this.visible()) {
        this.expanded.set(false);
      }
    });
  }

  protected toggle(): void {
    this.expanded.update((open) => !open);
  }

  protected select(action: MobileFabAction): void {
    // Taking an action always collapses; the shell opens the resulting pane.
    this.expanded.set(false);
    this.action.emit(action);
  }

  protected collapseOnEscape(): void {
    if (this.expanded()) {
      this.expanded.set(false);
    }
  }
}
