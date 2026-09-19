import {
  DESKTOP_BREAKPOINT_QUERY,
  MOBILE_BREAKPOINT_QUERY,
} from '../app/shared/constants/breakpoints';
import { installMatchMediaStub } from './match-media-stub';

/**
 * Pins the shared matchMedia stub itself: the specs that install it rely on
 * the flip, notification and unsubscribe behavior below.
 */
describe('installMatchMediaStub', () => {
  it('answers breakpoint queries and notifies listeners on flips', () => {
    const desktop = installMatchMediaStub();
    expect(window.matchMedia(DESKTOP_BREAKPOINT_QUERY).matches).toBe(false);

    const events: boolean[] = [];
    const listener = (event: { matches: boolean }): void => {
      events.push(event.matches);
    };
    window.matchMedia(DESKTOP_BREAKPOINT_QUERY).addEventListener('change', listener);

    desktop.setDesktop(true);
    expect(window.matchMedia(DESKTOP_BREAKPOINT_QUERY).matches).toBe(true);
    expect(events).toEqual([true]);
    // The DOM-level dispatch is a no-op that reports "not handled".
    expect(
      window.matchMedia(DESKTOP_BREAKPOINT_QUERY).dispatchEvent(new Event('change')),
    ).toBe(false);

    // The standard removal API stops the notifications.
    window.matchMedia(DESKTOP_BREAKPOINT_QUERY).removeEventListener('change', listener);
    desktop.setDesktop(false);
    expect(events).toEqual([true]);
  });

  it('supports the legacy addListener/removeListener API', () => {
    const mobile = installMatchMediaStub();
    const media = window.matchMedia(MOBILE_BREAKPOINT_QUERY);

    const events: boolean[] = [];
    const legacy = (event: { matches: boolean }): void => {
      events.push(event.matches);
    };
    media.addListener(legacy);
    mobile.setMobile(true);
    expect(events).toEqual([true]);

    media.removeListener(legacy);
    mobile.setMobile(false);
    expect(events).toEqual([true]);
  });
});
