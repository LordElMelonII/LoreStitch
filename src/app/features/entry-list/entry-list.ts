import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { CdkVirtualScrollViewport, ScrollingModule } from '@angular/cdk/scrolling';
import { FormField, form } from '@angular/forms/signals';
import { firstValueFrom } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatBadgeModule } from '@angular/material/badge';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { entryTags, entryTitle, entryTriggerState } from '../../core/models/lorebook.model';
import { memoEntryHaystack, memoEntryTokens } from '../../core/services/entry-memo';
import { formatTokenCount } from '../../core/services/token-estimator';
import { WorkspaceService } from '../../core/services/workspace.service';
import { paneResult, ProjectActionsService } from '../shell/project-actions.service';
import { ResponsiveOverlayService } from '../../shared/services/responsive-overlay.service';
import { LayoutService } from '../../shared/services/layout.service';
import { SEARCH_DEBOUNCE_MS } from '../../shared/constants/search';
import { debouncedSignal } from '../../shared/util/debounced-signal';
import { matchesQuery, applyRangeSelection, type EntryListItem } from './entry-list.model';
import { type BatchOperationsDialogData } from './batch-operations-dialog';
import { type DelimiterDialogData } from '../delimiters/delimiter-dialog.model';

/** Form model of the sidebar filter box. */
interface EntryFilterModel {
  query: string;
}

/**
 * Long-press threshold on a row checkbox before the touch range gesture
 * fires (task 20 D3). Exported for the specs, which drive the timer on a
 * faked clock.
 */
export const LONG_PRESS_MS = 500;

/**
 * Pointer drift (px) beyond which an armed long-press cancels: a drifting
 * finger is a scroll/abort intent, not a gesture (task 20 D3).
 */
const LONG_PRESS_SLOP_PX = 8;

/**
 * Sidebar listing every entry; supports filtering (text + tag), batch
 * selection with a bulk-actions bar, drag reorder and per-row actions.
 */
@Component({
  selector: 'app-entry-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DragDropModule,
    ScrollingModule,
    FormField,
    MatButtonModule,
    MatBadgeModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatMenuModule,
    MatTooltipModule,
  ],
  templateUrl: './entry-list.html',
  styleUrl: './entry-list.scss',
})
export class EntryList {
  protected readonly workspace = inject(WorkspaceService);
  protected readonly actions = inject(ProjectActionsService);
  /**
   * Viewport truth (`LayoutService` owns every media query). The in-drawer
   * header batch toolbar renders on tablet/desktop only: on phones the docked
   * bottom bar swaps to the batch actions while a selection is active (Task
   * 06 §3.2/§3.3), so an inline toolbar would shift the rows (defect 2) and
   * overflow the drawer (defect 3).
   */
  protected readonly layout = inject(LayoutService);
  private readonly dialog = inject(MatDialog);
  private readonly overlays = inject(ResponsiveOverlayService);
  private readonly snackBar = inject(MatSnackBar);

  private readonly viewport = viewChild.required(CdkVirtualScrollViewport);

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      // Both observers are standard in every browser; skip exotic environments
      // (e.g. bare jsdom) rather than crash.
      if (typeof ResizeObserver === 'undefined' || typeof IntersectionObserver === 'undefined') {
        return;
      }
      const viewport = this.viewport();
      const element = viewport.elementRef.nativeElement;
      // The CDK scroller measures its box once and only re-measures on window
      // resize. On mobile this list is created while the entries drawer is
      // still off-canvas, so that first measurement is wrong and would leave
      // the viewport under-filled forever. Re-check on real box resizes
      // (URL-bar dvh shifts) and whenever the drawer becomes visible; both
      // no-op once the scroller agrees with the live layout.
      const resizeObserver = new ResizeObserver(() => viewport.checkViewportSize());
      resizeObserver.observe(element);
      const intersectionObserver = new IntersectionObserver(() => viewport.checkViewportSize());
      intersectionObserver.observe(element);
      destroyRef.onDestroy(() => {
        resizeObserver.disconnect();
        intersectionObserver.disconnect();
      });
    });

    // Shift-click and long-press-release interception (task 20 D2/D3) must
    // run BEFORE the row checkbox's own activation: MatCheckbox flips its
    // state and emits the `(change)` output from the inner input's click
    // listener (target phase), so a bubble-phase preventDefault on the
    // checkbox host is too late — the native toggle would fire first and
    // corrupt the range anchor (verified in Chromium:
    // __screenshots__/task20-probe). A delegated capture-phase listener on
    // the host element is the earliest possible interception point; see
    // `interceptCheckboxClick`.
    const hostElement = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    hostElement.addEventListener('click', this.interceptCheckboxClick, true);
    destroyRef.onDestroy(() =>
      hostElement.removeEventListener('click', this.interceptCheckboxClick, true),
    );
    // A destroy while a touch press is armed (or fired but unswallowed) must
    // not fire the gesture against the dead component: drop the pending
    // timer and the armed press with it (task 20 P2).
    destroyRef.onDestroy(() => this.cancelLongPress());

    // Batch selection and tag filters are scoped to one project: opening
    // another project, importing a book or closing the project must drop
    // them, or the stale ids would drive silent no-op batch actions (and
    // ghosts in the batch bar). Only the project identity is tracked —
    // ordinary edits recreate the project object but keep the id.
    let selectedProjectId: string | null = null;
    effect(() => {
      const projectId = this.workspace.activeProject()?.id ?? null;
      if (projectId !== selectedProjectId) {
        untracked(() => {
          this.selection.set(new Set());
          this.tagFilter.set(new Set());
          this.selectionAnchor.set(null);
        });
      }
      selectedProjectId = projectId;
    });

    // Rollbacks keep the project id but can replace the whole entry list —
    // prune any selected id that no longer exists so batch actions never
    // run as silent no-ops against ghosts. (The filter only shrinks the
    // selection; an unchanged selection is returned by reference.)
    effect(() => {
      const known = new Set(
        this.workspace.entries().flatMap((e) => (e.id === undefined ? [] : [e.id])),
      );
      untracked(() =>
        this.selection.update((current) => {
          const next = new Set([...current].filter((id) => known.has(id)));
          return next.size === current.size ? current : next;
        }),
      );
    });

    // Appended entries (from the sidebar or the top bar "+") land at the
    // bottom of the list: bring the new row into view. A count change of
    // exactly +1 with a new highest id distinguishes an append from a book
    // import (whole-book replacement) or a duplicate (inserted mid-list).
    let previous: { count: number; lastId: number | null } | null = null;
    effect(() => {
      const entries = this.workspace.entries();
      const count = entries.length;
      const lastId = entries.at(-1)?.id ?? null;
      const appended =
        previous !== null &&
        count === previous.count + 1 &&
        lastId !== null &&
        (previous.lastId === null || lastId > previous.lastId);
      previous = { count, lastId };
      if (appended && lastId !== null) {
        untracked(() => {
          // Fresh entries have no keys or content: if an active filter would
          // hide the new row, clear the filter so it is actually visible.
          if (!this.filtered().some((item) => item.id === lastId)) {
            this.filterModel.set({ query: '' });
            // Revealing is a discrete action: apply the cleared query now,
            // or the reveal scroll below would look the row up in a view
            // still filtered by the not-yet-settled debounce.
            this.filterDebounced.flush();
            this.tagFilter.set(new Set());
          }
          this.scrollToEntry(lastId);
        });
      }
    });
  }

  private readonly filterModel = signal<EntryFilterModel>({ query: '' });
  protected readonly filterForm = form(this.filterModel);

  /** Current filter text (single source: the form model). */
  protected readonly filter = computed(() => this.filterModel().query);

  /**
   * The query the scan consumes: `filter` lagged by `SEARCH_DEBOUNCE_MS`,
   * so the O(book) scan runs at most once per settle window instead of per
   * keystroke. The input and its clear button stay immediate — typing never
   * feels laggy, only the settled list lags. Tag chips keep filtering
   * immediately: discrete taps, already cheap.
   */
  protected readonly filterDebounced = debouncedSignal(this.filter, SEARCH_DEBOUNCE_MS);

  /** Clears the filter box. */
  protected clearFilter(): void {
    this.filterModel.set({ query: '' });
  }

  // -------------------------------------------------------------------------
  // Batch selection & tag filter
  // -------------------------------------------------------------------------

  /** Selected entry ids for the batch suite. */
  protected readonly selection = signal<ReadonlySet<number>>(new Set());

  /**
   * Range-selection anchor (task 20 D1): the last row checkbox toggled
   * without a range gesture. A range gesture applies the inclusive
   * `filtered()` slice between this anchor and the gesture row; the anchor
   * only moves on a plain toggle (or on a degraded gesture) and is nulled
   * by `clearSelection()` and the project-switch reset.
   */
  private readonly selectionAnchor = signal<number | null>(null);

  /** Tags the filter isolates on: an entry must carry all of them. */
  protected readonly tagFilter = signal<ReadonlySet<string>>(new Set());

  protected readonly items = computed<EntryListItem[]>(() => {
    const dirty = this.workspace.dirtyEntryIds();
    return this.workspace.entries().map((entry) => {
      const title = entryTitle(entry);
      const keys = entry.keys ?? [];
      const tags = entryTags(entry);
      const content = entry.content ?? '';
      return {
        id: entry.id ?? -1,
        title,
        keys,
        enabled: entry.enabled,
        state: entryTriggerState(entry),
        dirty: entry.id !== undefined && dirty.has(entry.id),
        content,
        // Identity-memoized per-entry derivations (plan 18 D2): the
        // once-per-settle full-book pass costs O(changed) real work plus an
        // O(V) walk over memo hits, so a workspace mutation that only touched
        // one entry re-derives tokens/haystack for that entry alone.
        tokens: memoEntryTokens(entry),
        tags,
        // One fold per entry change, not per keystroke: the filter scan
        // below only ever runs `includes` over this pre-lowered haystack.
        search: memoEntryHaystack(entry),
      };
    });
  });

  /**
   * Stable identity for the virtual-scroll rows (plan 18 D6): unchanged
   * entries keep their row DOM across a book-wide mutation instead of every
   * row tearing down and re-rendering (`templateCacheSize: 0` stays — the
   * cache is deliberately off, so the track fn is what carries reuse).
   */
  protected trackById(_index: number, item: EntryListItem): number {
    return item.id;
  }

  /** All tags in the book, alphabetically (drives the filter chips). */
  protected readonly allTags = computed<string[]>(() => {
    const tags = new Set<string>();
    for (const item of this.items()) {
      for (const tag of item.tags) {
        tags.add(tag);
      }
    }
    return [...tags].sort((a, b) => a.localeCompare(b));
  });

  protected readonly filtered = computed<EntryListItem[]>(() => {
    const query = this.filterDebounced().trim().toLowerCase();
    const requiredTags = this.tagFilter();
    const all = this.items();
    const byTags = requiredTags.size
      ? all.filter((item) => {
          const owned = new Set(item.tags);
          for (const tag of requiredTags) {
            if (!owned.has(tag)) {
              return false;
            }
          }
          return true;
        })
      : all;
    if (!query) {
      return byTags;
    }
    return byTags.filter((item) => matchesQuery(item.search, query));
  });

  protected readonly activeId = computed(() => this.workspace.activeTabId());

  /**
   * How many entries the batch suite holds. Public (Task 06 §3.3): the shell
   * computes the bottom bar's `batch` state from it and forwards the count to
   * the bar's transplanted toolbar.
   */
  readonly selectionCount = computed(() => this.selection().size);

  /**
   * Whether every shown (filtered) entry is selected — the select-all
   * checkbox's checked side. Public so the shell can drive the bar's
   * transplanted checkbox and resolve the bar's select-all-shown emission.
   */
  readonly allFilteredSelected = computed(() => {
    const view = this.filtered();
    const selection = this.selection();
    return view.length > 0 && view.every((item) => selection.has(item.id));
  });

  /** Whether some — but not all — shown entries are selected (the checkbox's
   * indeterminate side). Public for the same bar contract as above. */
  readonly someFilteredSelected = computed(() => {
    const view = this.filtered();
    const selection = this.selection();
    return view.some((item) => selection.has(item.id)) && !this.allFilteredSelected();
  });

  protected toggleSelectAll(checked: boolean): void {
    if (checked) {
      const selection = new Set(this.selection());
      for (const item of this.filtered()) {
        selection.add(item.id);
      }
      this.selection.set(selection);
    } else {
      const selectedShown = new Set(this.filtered().map((item) => item.id));
      this.selection.update((current) => {
        const next = new Set<number>();
        for (const id of current) {
          if (!selectedShown.has(id)) {
            next.add(id);
          }
        }
        return next;
      });
    }
  }

  /**
   * Shell entry point for the bar's select-all-shown affordance (Task 06
   * §3.3): the same semantics as the header checkbox — checked selects every
   * shown entry, unchecked drops only the shown ones (entries selected but
   * hidden by the filter survive).
   */
  selectAllShown(checked: boolean): void {
    this.toggleSelectAll(checked);
  }

  protected toggleRow(item: EntryListItem, checked: boolean): void {
    // A plain (change)-path toggle is a non-gesture toggle: it always moves
    // the range anchor (task 20 D1) — including when a range gesture
    // degrades to this plain path.
    this.selectionAnchor.set(item.id);
    this.selection.update((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(item.id);
      } else {
        next.delete(item.id);
      }
      return next;
    });
  }

  /** Drops the whole selection. Public (Task 06 §3.3): the bar's ✕ in the
   * batch swap routes here through the shell. */
  clearSelection(): void {
    this.selection.set(new Set());
    // A cleared selection has no anchor to range from (task 20 D1).
    this.selectionAnchor.set(null);
  }

  // -------------------------------------------------------------------------
  // Range selection gestures (task 20 D1–D3, row checkbox only)
  // -------------------------------------------------------------------------

  /**
   * The touch press currently armed for a long-press: its row item and the
   * pointerdown position (for the drift slop). Transient gesture state,
   * deliberately not signals — nothing renders from it (task 20 D5).
   */
  private armedPress: { item: EntryListItem; x: number; y: number } | null = null;

  private longPressTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * A fired long-press whose release click has not been swallowed yet (D3):
   * the capture interceptor drops the click a browser synthesizes on
   * release, so the native toggle cannot apply the range a second time.
   * Deliberately not reset on destroy: the interceptor is unregistered then,
   * so no click can ever consult a stale `true` (and the next pointerdown
   * clears it regardless).
   */
  private suppressNextClick = false;

  /**
   * D1 range semantics for one gesture on `item` (a shift+click or a fired
   * long-press): every entry in the inclusive `filtered()` slice between
   * the anchor and `item` — either direction — takes `item`'s new state,
   * and the anchor does not move (gesture A→C then A→E covers A→E). With no
   * anchor, or an anchor gone from the current view (filtered out or
   * deleted), the gesture degrades to a plain single toggle of `item` and
   * the anchor moves to it.
   */
  private applyRangeGesture(item: EntryListItem): void {
    const anchorId = this.selectionAnchor();
    const current = this.selection();
    const target = !current.has(item.id);
    if (anchorId !== null) {
      const next = applyRangeSelection(current, this.filtered(), anchorId, item.id, target);
      if (next !== current) {
        this.selection.set(next);
        return;
      }
    }
    this.toggleRow(item, target);
  }

  /**
   * Capture-phase click interceptor over this component's subtree, bound in
   * the constructor (see the registration note there for why it must run
   * before the checkbox's own activation).
   */
  private readonly interceptCheckboxClick = (event: MouseEvent): void => {
    const row = event.target instanceof Element ? event.target.closest('.row-select') : null;
    if (!row) {
      return;
    }
    if (this.suppressNextClick) {
      // D3: the click a browser synthesizes after a fired long-press —
      // swallow it exactly once (cleared here or on the next pointerdown)
      // so the native toggle cannot apply the range a second time.
      this.suppressNextClick = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (!event.shiftKey) {
      // Plain click: nothing intercepted, the native (change) path stays
      // byte-identical.
      return;
    }
    // D2: cancel the native activation (label→input forwarding and the
    // input's own listener), then apply the range — the ONLY mutation.
    event.preventDefault();
    event.stopPropagation();
    // `data-entry-id` is stamped by the template; guard the empty string so
    // `Number('') === 0` cannot alias an id-0 entry — it degrades to NaN
    // like a missing attribute and the gesture is dropped.
    const rawId = row.getAttribute('data-entry-id');
    const id = rawId === null || rawId === '' ? Number.NaN : Number(rawId);
    const item = Number.isNaN(id) ? undefined : this.filtered().find((c) => c.id === id);
    if (item) {
      this.applyRangeGesture(item);
    }
  };

  /**
   * Arms the long-press timer for touch/pen presses on a row checkbox (D3).
   * The mouse never arms: desktop keeps shift+click semantics. Touch
   * pointers are implicitly captured by the pointerdown target, so the
   * host-bound move/up handlers keep seeing the pointer even as the finger
   * drifts off the small checkbox.
   */
  protected onRowSelectPointerDown(item: EntryListItem, event: PointerEvent): void {
    // A new press always clears a stale swallow flag (D3).
    this.suppressNextClick = false;
    this.cancelLongPress();
    if (event.pointerType === 'mouse') {
      return;
    }
    this.armedPress = { item, x: event.clientX, y: event.clientY };
    this.longPressTimer = setTimeout(() => {
      this.longPressTimer = null;
      const press = this.armedPress;
      this.armedPress = null;
      if (!press) {
        return;
      }
      this.suppressNextClick = true;
      this.applyRangeGesture(press.item);
    }, LONG_PRESS_MS);
  }

  /** Cancels the armed long-press once the finger drifts beyond the slop. */
  protected onRowSelectPointerMove(event: PointerEvent): void {
    const press = this.armedPress;
    if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > LONG_PRESS_SLOP_PX) {
      this.cancelLongPress();
    }
  }

  /** Release before the threshold: a plain tap — the native path owns it. */
  protected onRowSelectPointerUp(): void {
    this.cancelLongPress();
  }

  /**
   * The virtual scroller taking over a drag cancels the pointer — that is
   * the scroll path, never fought (D3).
   */
  protected onRowSelectPointerCancel(): void {
    this.cancelLongPress();
  }

  /**
   * Suppresses the checkbox contextmenu only while a touch press is armed
   * or has fired and not yet been swallowed — Android fires it on a held
   * press. A desktop right-click never finds either state set, so it stays
   * untouched (D3: guarded by gesture state, never unconditionally).
   */
  protected onRowSelectContextMenu(event: MouseEvent): void {
    if (this.armedPress !== null || this.suppressNextClick) {
      event.preventDefault();
    }
  }

  private cancelLongPress(): void {
    this.armedPress = null;
    if (this.longPressTimer !== null) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }

  protected toggleTagFilter(tag: string): void {
    this.tagFilter.update((current) => {
      const next = new Set(current);
      if (next.has(tag)) {
        next.delete(tag);
      } else {
        next.add(tag);
      }
      return next;
    });
  }

  protected isTagActive(tag: string): boolean {
    return this.tagFilter().has(tag);
  }

  // -------------------------------------------------------------------------
  // Row & batch actions
  // -------------------------------------------------------------------------

  protected open(item: EntryListItem): void {
    this.workspace.openEntry(item.id);
  }

  protected add(): void {
    this.workspace.addEntry();
    // Revealing (filter clearing + scroll to the appended row) is handled by
    // the append-tracking effect above, for both add buttons.
  }

  /** Smoothly brings an entry's row into the virtual viewport. */
  private scrollToEntry(entryId: number): void {
    // Let the virtual scroller register the appended row before scrolling.
    setTimeout(() => {
      const index = this.filtered().findIndex((item) => item.id === entryId);
      if (index >= 0) {
        this.viewport().scrollToIndex(index, 'smooth');
      }
    });
  }

  protected duplicate(item: EntryListItem): void {
    this.workspace.duplicateEntry(item.id);
  }

  /** Duplicates the selection. Public (Task 06 §3.3): the bar's batch menu
   * routes here through the shell. */
  duplicateSelection(): void {
    const ids = [...this.selection()];
    if (!ids.length) {
      return;
    }
    this.workspace.duplicateEntries(ids);
    this.snackBar.open(`Duplicated ${ids.length} entr${ids.length === 1 ? 'y' : 'ies'}.`, 'OK', {
      duration: 3000,
    });
  }

  protected delete(item: EntryListItem): void {
    this.workspace.deleteEntry(item.id);
    this.selection.update((current) => {
      if (!current.has(item.id)) {
        return current;
      }
      const next = new Set(current);
      next.delete(item.id);
      return next;
    });
  }

  /** Bulk-enables or bulk-disables the selection. Public (Task 06 §3.3): the
   * bar's batch menu routes here through the shell. */
  setSelectionEnabled(enabled: boolean): void {
    const ids = [...this.selection()];
    this.workspace.updateManyEntries(ids, () => ({ enabled }));
    this.snackBar.open(
      `${enabled ? 'Enabled' : 'Disabled'} ${ids.length} entr${ids.length === 1 ? 'y' : 'ies'}.`,
      'OK',
      { duration: 3000 },
    );
  }

  /** Deletes the selection behind its confirm dialog, then clears it. Public
   * (Task 06 §3.3): the bar's batch menu routes here through the shell, which
   * also re-focuses the entries pane once the (async) flow collapses the
   * selection. */
  async deleteSelection(): Promise<void> {
    const ids = [...this.selection()];
    if (!ids.length) {
      return;
    }
    // Lazy-loaded: keeps the confirm dialog out of the initial bundle.
    const { ConfirmDialog } = await import('../../shared/components/confirm-dialog/confirm-dialog');
    const confirmed = await firstValueFrom(
      this.dialog
        .open(ConfirmDialog, {
          panelClass: 'app-compact-fullscreen-dialog',
          data: {
            title: 'Delete entries',
            message: `Delete ${ids.length} selected entr${ids.length === 1 ? 'y' : 'ies'}? This can be recovered by rolling back in history.`,
            confirmLabel: 'Delete',
            danger: true,
          },
        })
        .afterClosed(),
    );
    if (!confirmed) {
      return;
    }
    this.workspace.deleteEntries(ids);
    this.clearSelection();
    this.snackBar.open(`Deleted ${ids.length} entr${ids.length === 1 ? 'y' : 'ies'}.`, 'OK', {
      duration: 3000,
    });
  }

  /**
   * Opens the batch editor over the current selection: centered dialog on
   * tablet/desktop, bottom sheet on phones (`ResponsiveOverlayService` owns
   * the viewport branch). Public so the mobile shell (bottom bar's Batch
   * edit item) can trigger it with the sidebar's live selection.
   */
  async openBatchOperations(): Promise<void> {
    const ids = [...this.selection()];
    if (!ids.length) {
      // The bottom bar's item is reachable with nothing selected; say so
      // instead of doing nothing.
      this.snackBar.open('Select entries first to batch edit.', 'OK', { duration: 3000 });
      return;
    }
    // Lazy-loaded: keeps the batch pane out of the initial bundle.
    const { BatchOperationsDialog } = await import('./batch-operations-dialog');
    const ref = this.overlays.openResponsive<
      InstanceType<typeof BatchOperationsDialog>,
      BatchOperationsDialogData,
      boolean
    >(BatchOperationsDialog, {
      data: { entryIds: ids },
      // Tablet/desktop config, identical to the former dialog.open() call.
      dialog: {
        width: '100%',
        maxWidth: 'min(96vw, 560px)',
        panelClass: 'app-compact-fullscreen-dialog',
      },
      sheetPanelClass: 'app-batch-sheet',
      sheetConfig: { ariaLabel: 'Batch edit entries' },
    });
    const applied = await paneResult(ref);
    if (applied) {
      this.clearSelection();
    }
  }

  /**
   * Opens the delimiter pane locked to the current selection (Task 12 §5.2,
   * D2): centered dialog on tablet/desktop, bottom sheet on phones
   * (`ResponsiveOverlayService` owns the viewport branch). The pane's
   * selection mode hides the Apply-to select and shows the checked count;
   * like Batch edit, the selection clears only when the pane closes truthy.
   * Public so the mobile shell (bottom bar's Delimiters item) routes here
   * through `App.runBatchBarAction`.
   */
  async openDelimiters(): Promise<void> {
    const ids = [...this.selection()];
    if (!ids.length) {
      // The bottom bar's item is reachable with nothing selected; say so
      // instead of doing nothing.
      this.snackBar.open('Select entries first to apply delimiters.', 'OK', { duration: 3000 });
      return;
    }
    // Lazy-loaded: keeps the delimiter pane out of the initial bundle.
    const { DelimiterDialog } = await import('../delimiters/delimiter-dialog');
    const ref = this.overlays.openResponsive<
      InstanceType<typeof DelimiterDialog>,
      DelimiterDialogData,
      boolean
    >(DelimiterDialog, {
      data: { entryIds: ids },
      // Same dialog config as the entry editor's opener — one pane width.
      dialog: {
        maxWidth: 'min(96vw, 860px)',
        panelClass: 'app-compact-fullscreen-dialog',
      },
      sheetPanelClass: 'app-delimiters-sheet',
      sheetConfig: { ariaLabel: 'Content delimiters' },
    });
    const applied = await paneResult(ref);
    if (applied) {
      this.clearSelection();
    }
  }

  /** Exports the selection as a standalone lorebook. Public (Task 06 §3.3):
   * the bar's call_split in the batch swap routes here through the shell. */
  exportSelection(): void {
    void this.actions.exportSelectedEntries([...this.selection()]);
  }

  protected formatTokens(tokens: number): string {
    return formatTokenCount(tokens);
  }

  protected drop(previousIndex: number, currentIndex: number): void {
    const view = this.filtered();
    if (view.length === this.items().length) {
      this.workspace.moveEntry(previousIndex, currentIndex);
    } else {
      // Translate viewport indexes back to working-tree indexes.
      const all = this.items();
      const moved = view[previousIndex];
      const target = view[currentIndex];
      if (!moved || !target) {
        return;
      }
      const from = all.findIndex((i) => i.id === moved.id);
      const to = all.findIndex((i) => i.id === target.id);
      if (from >= 0 && to >= 0) {
        this.workspace.moveEntry(from, to);
      }
    }
  }
}
