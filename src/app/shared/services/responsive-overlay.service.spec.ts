import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatBottomSheet, MatBottomSheetConfig } from '@angular/material/bottom-sheet';
import { MatDialog, MatDialogConfig } from '@angular/material/dialog';
import { Subject } from 'rxjs';
import { LayoutService } from './layout.service';
import { ResponsiveOverlayService } from './responsive-overlay.service';

/** Minimal stand-in for a dual-ref pane component (dialog or sheet content). */
@Component({ template: '' })
class PaneStub {}

describe('ResponsiveOverlayService', () => {
  let dialogOpen: ReturnType<typeof vi.fn>;
  let sheetOpen: ReturnType<typeof vi.fn>;
  /** Stands in for MatDialog's open-dialog registry (mutated by the tests). */
  let openDialogs: unknown[];
  /** Dialog stream stand-ins; the service subscribes in its constructor. */
  let afterOpened: Subject<void>;
  let afterAllClosed: Subject<void>;
  /** One dismissal stream per sheet ref the stub opener hands out. */
  let sheetDismissals: Subject<void>[];

  /**
   * Replaces the three dependencies with stubs: the openers return unique
   * markers so tests can pin which container (and ref) was used, and the
   * layout answers one fixed viewport class. Dialog/sheet lifecycle streams
   * become hand-pumped Subjects so the overlay-count logic is testable.
   */
  function createOverlay(isMobile: boolean): ResponsiveOverlayService {
    dialogOpen = vi.fn().mockReturnValue('dialog-ref');
    sheetDismissals = [];
    sheetOpen = vi.fn(() => {
      const dismissed = new Subject<void>();
      sheetDismissals.push(dismissed);
      return { afterDismissed: () => dismissed };
    });
    openDialogs = [];
    afterOpened = new Subject();
    afterAllClosed = new Subject();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: MatDialog,
          useValue: {
            open: dialogOpen,
            afterOpened,
            afterAllClosed,
            openDialogs,
          },
        },
        { provide: MatBottomSheet, useValue: { open: sheetOpen } },
        { provide: LayoutService, useValue: { isMobile: () => isMobile } },
      ],
    });
    return TestBed.inject(ResponsiveOverlayService);
  }

  it('opens a bottom sheet with the payload and panel class on phones', () => {
    const overlay = createOverlay(true);
    const data = { seed: 7 };

    const ref = overlay.openResponsive(PaneStub, {
      data,
      dialog: { width: '100%', panelClass: 'app-pane-dialog' },
      sheetPanelClass: 'app-pane-sheet',
    });

    expect(sheetOpen).toHaveBeenCalledTimes(1);
    expect(sheetOpen).toHaveBeenCalledWith(PaneStub, {
      data,
      panelClass: 'app-pane-sheet',
    });
    expect(dialogOpen).not.toHaveBeenCalled();
    expect(ref).toBe(sheetOpen.mock.results.at(-1)?.value);
  });

  it('opens the dialog with the full dialog config outside the phone class', () => {
    const overlay = createOverlay(false);
    const data = { seed: 7 };

    const ref = overlay.openResponsive(PaneStub, {
      data,
      dialog: {
        width: '100%',
        maxWidth: 'min(94vw, 680px)',
        panelClass: 'app-pane-dialog',
      },
      sheetPanelClass: 'app-pane-sheet',
    });

    expect(dialogOpen).toHaveBeenCalledTimes(1);
    expect(dialogOpen).toHaveBeenCalledWith(PaneStub, {
      width: '100%',
      maxWidth: 'min(94vw, 680px)',
      panelClass: 'app-pane-dialog',
      data,
    });
    expect(sheetOpen).not.toHaveBeenCalled();
    expect(ref).toBe('dialog-ref');
  });

  it('falls back to the dialog on phones when no sheet variant is registered', () => {
    const overlay = createOverlay(true);
    const data = { seed: 7 };

    overlay.openResponsive(PaneStub, {
      data,
      dialog: { panelClass: 'app-pane-dialog' },
    });

    expect(dialogOpen).toHaveBeenCalledTimes(1);
    expect(dialogOpen).toHaveBeenCalledWith(PaneStub, {
      panelClass: 'app-pane-dialog',
      data,
    });
    expect(sheetOpen).not.toHaveBeenCalled();
  });

  it('merges extra sheet options without letting them override the canonical fields', () => {
    const overlay = createOverlay(true);
    const data = { seed: 7 };

    overlay.openResponsive(PaneStub, {
      data,
      dialog: { panelClass: 'app-pane-dialog' },
      sheetPanelClass: 'app-pane-sheet',
      sheetConfig: {
        ariaLabel: 'Pane details',
        disableClose: true,
        data: { seed: 0 },
        panelClass: 'clobbered',
      },
    });

    expect(sheetOpen).toHaveBeenCalledTimes(1);
    expect(sheetOpen).toHaveBeenCalledWith(PaneStub, {
      ariaLabel: 'Pane details',
      disableClose: true,
      data,
      panelClass: 'app-pane-sheet',
    });
  });

  it('treats the top-level data as the only data source', () => {
    const overlay = createOverlay(false);

    overlay.openResponsive<PaneStub, string, void>(PaneStub, {
      data: 'fresh',
      dialog: { panelClass: 'app-pane-dialog', data: 'stale' },
    });

    const call = dialogOpen.mock.calls.at(-1);
    assert(call);
    const options = call[1] as MatDialogConfig<string>;
    expect(options.data).toBe('fresh');
  });

  it('omits the data key entirely on the dialog path when no payload is given', () => {
    const overlay = createOverlay(true);

    overlay.openResponsive(PaneStub, {
      dialog: { panelClass: 'app-pane-dialog' },
    });

    // Absent, not `undefined`: Material then keeps its `data = null`
    // default, byte-identical to calling open() without a data field.
    const call = dialogOpen.mock.calls.at(-1);
    assert(call);
    const options = call[1] as MatDialogConfig<unknown>;
    expect('data' in options).toBe(false);
  });

  it('omits the data key entirely on the sheet path when no payload is given', () => {
    const overlay = createOverlay(true);

    overlay.openResponsive(PaneStub, {
      dialog: { panelClass: 'app-pane-dialog' },
      sheetPanelClass: 'app-pane-sheet',
    });

    // The About pane's phone path: the sheet config must carry nothing
    // beyond the panel class, exactly like the previous direct
    // bottomSheet.open(component, { panelClass }) call.
    const call = sheetOpen.mock.calls.at(-1);
    assert(call);
    const [component, options] = call as [object, MatBottomSheetConfig<unknown>];
    expect(component).toBe(PaneStub);
    expect(options).toEqual({ panelClass: 'app-pane-sheet' });
    expect('data' in options).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Overlay-open tracking (drives the mobile FAB's hide-while-modal rule)
  // -------------------------------------------------------------------------

  it('starts with no overlay open', () => {
    const overlay = createOverlay(false);

    expect(overlay.anyOverlayOpen()).toBe(false);
  });

  it('counts dialogs app-wide from afterOpened until afterAllClosed', () => {
    const overlay = createOverlay(false);

    // Any MatDialog.open (through this service or a direct call elsewhere):
    // the registry gains entries and afterOpened fires, so the count follows
    // the registry length, stacked dialogs included.
    openDialogs.push({}, {});
    afterOpened.next();
    expect(overlay.anyOverlayOpen()).toBe(true);

    afterAllClosed.next();
    expect(overlay.anyOverlayOpen()).toBe(false);
  });

  it('counts each sheet this service opens until that sheet dismisses', () => {
    const overlay = createOverlay(true);

    overlay.openResponsive(PaneStub, {
      dialog: { panelClass: 'app-pane-dialog' },
      sheetPanelClass: 'app-pane-sheet',
    });
    expect(overlay.anyOverlayOpen()).toBe(true);

    sheetDismissals[0]?.next();
    expect(overlay.anyOverlayOpen()).toBe(false);
  });

  it('keeps the flag up while any one of several sheets is still open', () => {
    const overlay = createOverlay(true);

    overlay.openResponsive(PaneStub, {
      dialog: { panelClass: 'app-pane-dialog' },
      sheetPanelClass: 'app-pane-sheet',
    });
    overlay.openResponsive(PaneStub, {
      dialog: { panelClass: 'app-pane-dialog' },
      sheetPanelClass: 'app-pane-sheet',
    });

    sheetDismissals[0]?.next();
    expect(overlay.anyOverlayOpen()).toBe(true);

    sheetDismissals[1]?.next();
    expect(overlay.anyOverlayOpen()).toBe(false);
  });

  it('combines the dialog and sheet counts into one flag', () => {
    const overlay = createOverlay(true);

    openDialogs.push({});
    afterOpened.next();
    overlay.openResponsive(PaneStub, {
      dialog: { panelClass: 'app-pane-dialog' },
      sheetPanelClass: 'app-pane-sheet',
    });
    expect(overlay.anyOverlayOpen()).toBe(true);

    // The sheet alone dismissing must not clear the flag while a dialog is
    // still up.
    sheetDismissals[0]?.next();
    expect(overlay.anyOverlayOpen()).toBe(true);

    afterAllClosed.next();
    expect(overlay.anyOverlayOpen()).toBe(false);
  });
});
