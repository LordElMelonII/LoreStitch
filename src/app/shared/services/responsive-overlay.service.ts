import { Service, inject } from '@angular/core';
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
      return this.bottomSheet.open<T, D, R>(component, sheetOptions);
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
