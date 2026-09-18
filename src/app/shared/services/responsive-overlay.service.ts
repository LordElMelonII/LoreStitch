import { Service, computed, inject, signal } from '@angular/core';
import { ComponentType } from '@angular/cdk/portal';
import {
  MatBottomSheet,
  MatBottomSheetConfig,
  MatBottomSheetRef,
} from '@angular/material/bottom-sheet';
import { MatDialog, MatDialogConfig, MatDialogRef } from '@angular/material/dialog';
import { LayoutService } from './layout.service';

/**
 * Options for `ResponsiveOverlayService.openResponsive`.
 *
 * `data` is canonical at this top level — the only place it is read from. A
 * `data` key nested inside `dialog` or `sheetConfig` is ignored, so the two
 * containers can never disagree about the payload they inject.
 */
export interface ResponsiveOverlayConfig<D> {
  /** Payload injected into the opened component via the container's data token. */
  data?: D;
  /**
   * Configuration for the `MatDialog` path — tablet/desktop viewports, and
   * phones when no sheet variant is registered: width, panelClass, etc.
   */
  dialog: MatDialogConfig<D>;
  /**
   * `panelClass` of the `MatBottomSheet` rendered on phones (< 768px). Omit
   * it to keep the component dialog-only on every viewport.
   */
  sheetPanelClass?: string;
  /**
   * Extra bottom-sheet options (e.g. `ariaLabel`, `disableClose`). Genuine
   * extras only: `data` and `panelClass` always come from the canonical
   * top-level `data` / `sheetPanelClass` fields.
   */
  sheetConfig?: Partial<MatBottomSheetConfig<D>>;
}

/**
 * Central opener for dual-container panes: phones (< 768px, per
 * `LayoutService`, the single source of viewport truth) get a
 * `MatBottomSheet` while every other viewport gets a `MatDialog` — one call
 * site instead of the viewport branching each caller used to carry. The
 * opened component adapts by optionally injecting `MatDialogRef` and
 * `MatBottomSheetRef`, exactly like the About pane.
 */
@Service()
export class ResponsiveOverlayService {
  private readonly dialog = inject(MatDialog);
  private readonly bottomSheet = inject(MatBottomSheet);
  private readonly layout = inject(LayoutService);

  /**
   * Open `MatDialog` count, maintained app-wide: every dialog open — through
   * this service or a direct `MatDialog.open` (search & replace, new
   * project, confirms) — refreshes it from MatDialog's own registry, and
   * `afterAllClosed` clears it.
   */
  private readonly openDialogCount = signal(0);

  /**
   * Open `MatBottomSheet` count. The bottom sheet exposes no registry the
   * way `MatDialog.openDialogs` does, and this service is the app's only
   * sheet opener, so the count tracks exactly the refs opened here.
   */
  private readonly openSheetCount = signal(0);

  /**
   * Whether any modal pane currently covers the app: any dialog app-wide or
   * any sheet this service opened. The mobile FAB hides while this is true
   * so it never competes with (or peeks out from under) a modal surface.
   */
  readonly anyOverlayOpen = computed(() => this.openDialogCount() + this.openSheetCount() > 0);

  constructor() {
    // App-wide dialog tracking. `afterOpened` fires per open and re-reads
    // the live registry (stacked dialogs included); `afterAllClosed` fires
    // once the last one dismisses and zeroes the count.
    this.dialog.afterOpened.subscribe(
      () => this.openDialogCount.set(this.dialog.openDialogs.length),
    );
    this.dialog.afterAllClosed.subscribe(() => this.openDialogCount.set(0));
  }

  /**
   * Opens `component` as a bottom sheet on phones (when a sheet variant is
   * registered) and as a dialog everywhere else. Returns whichever ref the
   * active container produced; callers that need to narrow it can check
   * `instanceof MatDialogRef`.
   */
  openResponsive<T, D = unknown, R = unknown>(
    component: ComponentType<T>,
    config: ResponsiveOverlayConfig<D>,
  ): MatDialogRef<T, R> | MatBottomSheetRef<T, R> {
    const { data, dialog, sheetPanelClass, sheetConfig } = config;

    // Phones get the sheet only when the caller registered one; tablet and
    // desktop viewports (and dialog-only panes) take the dialog path.
    if (sheetPanelClass && this.layout.isMobile()) {
      const sheetOptions: MatBottomSheetConfig<D> = {
        ...sheetConfig,
        panelClass: sheetPanelClass,
      };
      // Top-level `data` is canonical: strip any sheetConfig copy, then set
      // the key only when a payload exists so Material keeps its
      // `data = null` default otherwise, like a direct open() without data.
      delete sheetOptions.data;
      if (data !== undefined) {
        sheetOptions.data = data;
      }
      const ref = this.bottomSheet.open<T, D, R>(component, sheetOptions);
      // Sheet bookkeeping for `anyOverlayOpen`: release the slot when this
      // exact sheet dismisses. The clamp keeps a stray double-dismiss from
      // ever driving the count negative.
      this.openSheetCount.update((count) => count + 1);
      ref.afterDismissed().subscribe(() =>
        this.openSheetCount.update((count) => Math.max(0, count - 1)),
      );
      return ref;
    }

    const dialogOptions: MatDialogConfig<D> = { ...dialog };
    // Same canonicality rule on the dialog path: `dialog.data` never wins.
    delete dialogOptions.data;
    if (data !== undefined) {
      dialogOptions.data = data;
    }
    return this.dialog.open<T, D, R>(component, dialogOptions);
  }
}
