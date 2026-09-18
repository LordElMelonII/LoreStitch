import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Component } from '@angular/core';
import { MatMenuModule, MatMenuTrigger } from '@angular/material/menu';
import {
  EMULATED_HOVER_WINDOW_MS,
  TouchSafeNestedMenuTrigger,
} from './touch-safe-nested-menu-trigger';

/**
 * Regression coverage for the phones-only nested-menu flash: touching a
 * nested trigger (Export / Theme inside "More actions") used to open the
 * submenu through the emulated-hover path mid-tap, and the tap's remaining
 * emulated events then landed on the just-opened panel — flashing the
 * submenu closed and mis-firing a submenu action.
 */

@Component({
  imports: [MatMenuModule, TouchSafeNestedMenuTrigger],
  template: `
    <button type="button" [matMenuTriggerFor]="parent" aria-label="More actions menu">
      More
    </button>
    <mat-menu #parent="matMenu">
      <button mat-menu-item [matMenuTriggerFor]="child" appTouchSafeNestedMenuTrigger>
        Export
      </button>
    </mat-menu>
    <mat-menu #child="matMenu">
      <button mat-menu-item>World Info JSON</button>
    </mat-menu>
  `,
})
class TouchSafeHost {}

/** A pointer event of the given type attributed to a touch contact. */
function touchPointer(type: 'pointerdown' | 'pointerup'): Event {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true });
  // jsdom lacks a PointerEvent constructor; the directive only reads
  // pointerType, which is all a real pointerdown carries.
  Object.defineProperty(event, 'pointerType', { value: 'touch' });
  return event;
}

/** A pointer event attributed to a mouse (the desktop path must stay open). */
function mousePointer(type: 'pointerdown' | 'pointerup'): Event {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'pointerType', { value: 'mouse' });
  return event;
}

/** Non-bubbling hover, exactly as browsers dispatch it. */
function mouseEnter(): Event {
  return new MouseEvent('mouseenter', { bubbles: false, cancelable: true });
}

/** Bubbling click, as dispatched after the emulated mouse sequence. */
function click(): Event {
  return new MouseEvent('click', { bubbles: true, cancelable: true });
}

describe('TouchSafeNestedMenuTrigger', () => {
  let fixture: import('@angular/core/testing').ComponentFixture<TouchSafeHost>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TouchSafeHost],
    }).compileComponents();
    fixture = TestBed.createComponent(TouchSafeHost);
    await fixture.whenStable();
    fixture.detectChanges();
  });

  /** Opens the parent menu (stamping the nested trigger) and wires both. */
  function openParent(): { item: HTMLElement; nested: MatMenuTrigger } {
    const parentDebug = fixture.debugElement.query(By.css('[aria-label="More actions menu"]'));
    assert(parentDebug);
    parentDebug.injector.get(MatMenuTrigger).openMenu();
    fixture.detectChanges();

    const itemDebug = fixture.debugElement.query(By.directive(TouchSafeNestedMenuTrigger));
    assert(itemDebug);
    return {
      item: itemDebug.nativeElement as HTMLElement,
      nested: itemDebug.injector.get(MatMenuTrigger),
    };
  }

  it('suppresses the emulated hover of a touch tap so the submenu opens once, on the click', () => {
    const { item, nested } = openParent();

    item.dispatchEvent(touchPointer('pointerdown'));
    // The browser-emulated hover that a tap fires before its click: without
    // the directive this opens the submenu mid-tap (the production flash).
    item.dispatchEvent(mouseEnter());
    expect(nested.menuOpen).toBe(false);

    // The tap's click reaches Material's own click path and opens the child.
    item.dispatchEvent(click());
    expect(nested.menuOpen).toBe(true);

    // Further emulated hovers inside the touch window never toggle it.
    item.dispatchEvent(mouseEnter());
    expect(nested.menuOpen).toBe(true);
  });

  it('closes the open submenu when the trigger is tapped a second time', () => {
    const { item, nested } = openParent();

    // A plain click opens (Material's behavior, untouched by the directive).
    item.dispatchEvent(click());
    expect(nested.menuOpen).toBe(true);

    item.dispatchEvent(touchPointer('pointerdown'));
    item.dispatchEvent(mouseEnter());
    item.dispatchEvent(click());
    expect(nested.menuOpen).toBe(false);
  });

  it('keeps hover-to-open working for the mouse', () => {
    const { item, nested } = openParent();

    item.dispatchEvent(mouseEnter());
    expect(nested.menuOpen).toBe(true);
  });

  it('does not arm the touch window from mouse pointer events', () => {
    const { item, nested } = openParent();

    item.dispatchEvent(mousePointer('pointerdown'));
    item.dispatchEvent(mouseEnter());
    expect(nested.menuOpen).toBe(true);
  });

  it('stops suppressing hover once the touch window has expired', async () => {
    const { item, nested } = openParent();

    item.dispatchEvent(touchPointer('pointerdown'));
    item.dispatchEvent(mouseEnter());
    expect(nested.menuOpen).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, EMULATED_HOVER_WINDOW_MS + 50));

    // A fresh mouse hover (no touch re-arming) behaves like a desktop hover.
    item.dispatchEvent(mouseEnter());
    expect(nested.menuOpen).toBe(true);
  });

  it('re-arms the touch window from a later touch contact', async () => {
    const { item, nested } = openParent();

    item.dispatchEvent(touchPointer('pointerdown'));
    await new Promise((resolve) => setTimeout(resolve, EMULATED_HOVER_WINDOW_MS + 50));
    item.dispatchEvent(mouseEnter());
    expect(nested.menuOpen).toBe(true);
    nested.closeMenu();
    expect(nested.menuOpen).toBe(false);

    // The expired window does not stick: a new touch suppresses again.
    item.dispatchEvent(touchPointer('pointerdown'));
    item.dispatchEvent(mouseEnter());
    expect(nested.menuOpen).toBe(false);
  });

  it('removes its document listeners when the menu content is destroyed', () => {
    const { item, nested } = openParent();
    item.dispatchEvent(click());
    expect(nested.menuOpen).toBe(true);

    const removeSpy = vi.spyOn(document, 'removeEventListener');
    fixture.destroy();
    // Both document-level capture listeners must be torn down with the
    // directive instance, or later document-wide hovers/clicks would keep
    // hitting a dead menu item.
    const removedEvents = removeSpy.mock.calls.map((call) => call[0]);
    expect(removedEvents).toContain('mouseenter');
    expect(removedEvents).toContain('click');

    // Post-destroy dispatches are plain no-ops, not throws. (Material's own
    // trigger teardown disposes the overlay without resetting its internal
    // open flag, so there is no observable state flip to assert here.)
    expect(() => item.dispatchEvent(mouseEnter())).not.toThrow();
    expect(() => item.dispatchEvent(click())).not.toThrow();
  });
});
