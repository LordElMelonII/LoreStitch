import {
  DOCUMENT,
  DestroyRef,
  Directive,
  ElementRef,
  inject,
} from '@angular/core';
import { isFakeTouchstartFromScreenReader } from '@angular/cdk/a11y';
import { MatMenuTrigger } from '@angular/material/menu';

/**
 * How long after a real touch contact the trigger treats `mouseenter` as the
 * browser's touch emulation rather than a desktop hover. The emulated
 * mouseover/mouseenter/mousedown/click sequence fires within milliseconds of
 * the finger lifting, but a long press lifts much later — the window is
 * re-armed on every touch `pointerdown`/`pointerup`, so it only needs to
 * cover the gap between the last contact event and the emulated click.
 */
export const EMULATED_HOVER_WINDOW_MS = 800;

/**
 * Makes a nested `matMenuTriggerFor` (a `mat-menu-item` inside another menu)
 * touch-safe.
 *
 * Material opens submenu triggers on hover with no pointer-type guard: the
 * item's `mouseenter` feeds the parent menu's hover stream and the trigger
 * opens synchronously (`MatMenuItem._handleMouseEnter` → `MatMenu._hovered()`
 * → `MatMenuTrigger._handleHover` → `_openMenu`). On a touchscreen the tap
 * itself emits an emulated `mouseenter`, so the submenu opens mid-tap — and
 * on narrow viewports its fallback position overlaps the parent panel, right
 * under the finger. The tap's remaining emulated `mousedown`/`click` then
 * land on the just-opened submenu instead of the trigger: an unintended
 * submenu action fires, the panel's `(click)` closes the submenu and re-closes
 * the parent — the "submenu flashes open then everything disappears" bug.
 *
 * This directive suppresses only that emulated hover: while a real touch is
 * in flight, `mouseenter` events targeting the trigger are stopped in the
 * capture phase before Material ever sees them. The tap's `click` then opens
 * the submenu exactly once through Material's own click path, after every
 * pointer-derived event has been dispatched — so nothing can land on it. A
 * second tap on an already-open trigger toggles it closed (Material's click
 * handler only ever opens submenu triggers; closing is a touch-only
 * addition). Desktop hover, click and keyboard (Enter/Space/arrow) behavior
 * are untouched because the flag is armed exclusively by touch contact.
 *
 * Capture listeners live on `document` — an ancestor of every CDK overlay
 * panel — because a listener on the trigger element itself cannot reliably
 * beat Material's same-element host listeners (at the target, listeners run
 * in registration order regardless of the capture flag; capture on an
 * ancestor always wins). Instances exist only while the owning menu is open
 * (menu content is stamped into the overlay on open), so the document-level
 * listeners are transient.
 *
 * Known trade-off: with the emulated hover suppressed, Material's
 * hover-driven "open one submenu closes the sibling" switch no longer runs
 * when tapping a second nested trigger directly. Both submenus can then be
 * open at once until the next plain-item tap or outside tap closes them.
 *
 * Usage: `<button mat-menu-item [matMenuTriggerFor]="child"
 * appTouchSafeNestedMenuTrigger>Export</button>` — standalone (non-nested)
 * triggers must NOT carry it.
 */
@Directive({
  selector: '[appTouchSafeNestedMenuTrigger]',
})
export class TouchSafeNestedMenuTrigger {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly document = inject(DOCUMENT);

  /** The nested trigger sharing this element; null if applied without one. */
  private readonly trigger = inject(MatMenuTrigger, { optional: true, self: true });

  /**
   * True from a real touch contact until just after it ends: while armed,
   * `mouseenter` on the trigger is treated as emulation, not hover.
   */
  private touchArmed = false;
  private disarmTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly teardown: (() => void)[] = [];

  constructor() {
    const host = this.host.nativeElement;
    const disarm = (): void => {
      this.touchArmed = false;
    };
    const arm = (): void => {
      this.touchArmed = true;
      if (this.disarmTimeout !== null) {
        clearTimeout(this.disarmTimeout);
      }
      this.disarmTimeout = setTimeout(disarm, EMULATED_HOVER_WINDOW_MS);
    };
    const armIfTouch = (event: Event): void => {
      // 'pen' also emulates mouse events, but the brief scopes this fix to
      // touch; pen users with a digitizer still get desktop hover behavior.
      if ((event as PointerEvent).pointerType === 'touch') {
        arm();
      }
    };
    const armUnlessScreenReader = (event: Event): void => {
      // Same guard Material's own trigger uses when tagging `_openedBy`:
      // explore-by-touch screen readers synthesize touch events too.
      if (!isFakeTouchstartFromScreenReader(event as TouchEvent)) {
        arm();
      }
    };
    const onTouchHost = (event: Event): void => {
      if (!host.contains(event.target as Node | null)) {
        return;
      }
      if (!this.touchArmed) {
        return;
      }
      // Swallow the emulated hover before Material's item listener runs:
      // the submenu must not open mid-tap, only on the tap's click.
      event.stopPropagation();
    };
    const onClickCapture = (event: Event): void => {
      if (!host.contains(event.target as Node | null)) {
        return;
      }
      if (!this.touchArmed) {
        return;
      }
      // Opening tap: leave the click to Material's own submenu handling.
      if (!this.trigger?.menuOpen) {
        return;
      }
      // Second tap on an open trigger closes it (touch-only toggle).
      event.stopPropagation();
      this.trigger.closeMenu();
    };

    // Contact arming: pointer events cover every current browser; touchstart
    // is the same fallback Material listens on for `_openedBy = 'touch'`.
    host.addEventListener('pointerdown', armIfTouch);
    host.addEventListener('pointerup', armIfTouch);
    host.addEventListener('touchstart', armUnlessScreenReader, { passive: true });
    host.addEventListener('touchend', armUnlessScreenReader, { passive: true });

    // Capture on `document` runs before Material's target-level listeners on
    // the menu item (capture on an ancestor beats target/bubble listeners).
    this.document.addEventListener('mouseenter', onTouchHost, true);
    this.document.addEventListener('click', onClickCapture, true);

    this.teardown.push(
      () => host.removeEventListener('pointerdown', armIfTouch),
      () => host.removeEventListener('pointerup', armIfTouch),
      () => host.removeEventListener('touchstart', armUnlessScreenReader),
      () => host.removeEventListener('touchend', armUnlessScreenReader),
      () => this.document.removeEventListener('mouseenter', onTouchHost, true),
      () => this.document.removeEventListener('click', onClickCapture, true),
    );

    inject(DestroyRef).onDestroy(() => {
      if (this.disarmTimeout !== null) {
        clearTimeout(this.disarmTimeout);
      }
      for (const dispose of this.teardown) {
        dispose();
      }
    });
  }
}
