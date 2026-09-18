import { TestBed } from '@angular/core/testing';
import { BreakpointObserver } from '@angular/cdk/layout';
import { map, Subject } from 'rxjs';
import {
  DESKTOP_BREAKPOINT_QUERY,
  MOBILE_BREAKPOINT_QUERY,
  TABLET_BREAKPOINT_QUERY,
} from '../constants/breakpoints';
import { LayoutService } from './layout.service';

/**
 * Replaces `BreakpointObserver` with a controllable emitter: each `emit`
 * lands in the service as if the window had resized to that query state.
 */
function installObserverStub(): {
  observe: ReturnType<typeof vi.fn>;
  emit: (breakpoints: Record<string, boolean>) => void;
} {
  const emissions = new Subject<Record<string, boolean>>();
  const observe = vi.fn(() =>
    emissions.pipe(
      map((breakpoints) => ({
        matches: Object.values(breakpoints).some(Boolean),
        breakpoints,
      })),
    ),
  );
  TestBed.configureTestingModule({
    providers: [{ provide: BreakpointObserver, useValue: { observe } }],
  });
  return { observe, emit: (breakpoints) => emissions.next(breakpoints) };
}

describe('LayoutService', () => {
  it('observes the three window-class queries exactly once', () => {
    const { observe } = installObserverStub();

    TestBed.inject(LayoutService);

    expect(observe).toHaveBeenCalledTimes(1);
    expect(observe).toHaveBeenCalledWith([
      MOBILE_BREAKPOINT_QUERY,
      TABLET_BREAKPOINT_QUERY,
      DESKTOP_BREAKPOINT_QUERY,
    ]);
  });

  it('classifies each matching query into its viewport class', () => {
    const { emit } = installObserverStub();
    const layout = TestBed.inject(LayoutService);

    emit({
      [MOBILE_BREAKPOINT_QUERY]: true,
      [TABLET_BREAKPOINT_QUERY]: false,
      [DESKTOP_BREAKPOINT_QUERY]: false,
    });
    expect(layout.viewport()).toBe('mobile');
    expect(layout.isMobile()).toBe(true);
    expect(layout.isDesktop()).toBe(false);

    emit({
      [MOBILE_BREAKPOINT_QUERY]: false,
      [TABLET_BREAKPOINT_QUERY]: true,
      [DESKTOP_BREAKPOINT_QUERY]: false,
    });
    expect(layout.viewport()).toBe('tablet');
    expect(layout.isMobile()).toBe(false);
    expect(layout.isDesktop()).toBe(false);

    emit({
      [MOBILE_BREAKPOINT_QUERY]: false,
      [TABLET_BREAKPOINT_QUERY]: false,
      [DESKTOP_BREAKPOINT_QUERY]: true,
    });
    expect(layout.viewport()).toBe('desktop');
    expect(layout.isMobile()).toBe(false);
    expect(layout.isDesktop()).toBe(true);
  });

  it('defaults to desktop before the first emission and when nothing matches', () => {
    const { emit } = installObserverStub();
    const layout = TestBed.inject(LayoutService);

    // No emission yet: the initialValue mirrors environments without
    // matchMedia (jsdom), where the shell must still lay out as desktop.
    expect(layout.viewport()).toBe('desktop');
    expect(layout.isDesktop()).toBe(true);

    // A window class where none of the three queries answers also falls
    // through to desktop, exactly like the shell's previous private logic.
    emit({
      [MOBILE_BREAKPOINT_QUERY]: false,
      [TABLET_BREAKPOINT_QUERY]: false,
      [DESKTOP_BREAKPOINT_QUERY]: false,
    });
    expect(layout.viewport()).toBe('desktop');
  });

  it('toggles focus mode', () => {
    installObserverStub();
    const layout = TestBed.inject(LayoutService);

    expect(layout.focusMode()).toBe(false);
    layout.toggleFocusMode();
    expect(layout.focusMode()).toBe(true);
    layout.toggleFocusMode();
    expect(layout.focusMode()).toBe(false);
  });
});
