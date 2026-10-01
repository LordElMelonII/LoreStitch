import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DOCUMENT } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { ResponsiveOverlayService } from './responsive-overlay.service';
import { KeyboardShortcutsService, type ShortcutHandler } from './keyboard-shortcuts.service';
import { installMatchMediaStub } from '../../../testing/match-media-stub';
import { EntryList } from '../../features/entry-list/entry-list';
import { WorkspaceService } from '../../core/services/workspace.service';
import { entryWith as entry, projectOf } from '../../../testing/project-fixtures';
import type { ShortcutAction, ShortcutScope } from '../../core/models/shortcut-map';

/**
 * Scope classification and claim discipline of the global keydown listener
 * (Task 10 §3.2, §3.8 row 3): real dispatched `KeyboardEvent`s against a
 * mounted `app-entry-list` fixture pin the classification table verified
 * against the rendered Material DOM (see `classifyScope`'s table), the
 * preventDefault-only-when-handled contract, the overlay gate, and the
 * DestroyRef teardown.
 */
describe('KeyboardShortcutsService', () => {
  let fixture: ComponentFixture<EntryList>;
  let workspace: WorkspaceService;
  let overlayOpen: () => boolean;
  let dispatched: { action: ShortcutAction; scope: ShortcutScope }[];
  let wrapper: HTMLElement | null = null;

  /**
   * Mounts an entry list over a seeded project and registers a capture
   * handler on the service. The fixture is nested under a real
   * `<app-entry-list>` element because the unit-test builder's own host
   * element is a bare div — the production host tag the scope classifier
   * reads must exist in the tree, exactly as the shell renders it. The
   * service's listener is the single DOCUMENT keydown listener, so
   * dispatches below bubble exactly as a browser would.
   */
  async function createHarness(
    entries = [entry(0), entry(1), entry(2)],
    registerHandler = true,
  ): Promise<void> {
    workspace.activeProject.set(projectOf(entries));
    fixture = TestBed.createComponent(EntryList);
    await fixture.whenStable();
    fixture.detectChanges();
    wrapper = document.createElement('app-entry-list');
    wrapper.appendChild(fixture.nativeElement);
    document.body.appendChild(wrapper);
    if (registerHandler) {
      const shortcuts = TestBed.inject(KeyboardShortcutsService);
      shortcuts.register((action, scope) => dispatched.push({ action, scope }));
    }
  }

  /** Dispatches a real keydown on `target` and returns the (possibly claimed) event. */
  function press(target: Element, init: KeyboardEventInit): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    return event;
  }

  /** The i-th rendered row (rows are fully rendered for the small books used here). */
  function rowAt(index: number): HTMLElement {
    const rows = (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.entry-item');
    const row = rows[index];
    assert(row);
    return row;
  }

  beforeEach(async () => {
    // LayoutService's breakpoint observer needs matchMedia (jsdom has none).
    installMatchMediaStub();
    overlayOpen = vi.fn(() => false);
    dispatched = [];
    await TestBed.configureTestingModule({
      imports: [EntryList],
      providers: [
        { provide: MatDialog, useValue: { open: vi.fn() } },
        {
          provide: ResponsiveOverlayService,
          useValue: { anyOverlayOpen: () => overlayOpen(), openResponsive: vi.fn() },
        },
      ],
    }).compileComponents();
    workspace = TestBed.inject(WorkspaceService);
    // Allow the workspace's async init() to settle before the component reads it.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  afterEach(() => {
    // Drop the mounted harness (fixture + wrapper) so later tests — and the
    // injector-destroy teardown pin — start from a clean document.
    wrapper?.remove();
    wrapper = null;
  });

  it('classifies a focused entry row as list scope', async () => {
    await createHarness();
    const event = press(rowAt(0), { key: 'ArrowDown' });
    expect(dispatched).toEqual([{ action: 'nav-next', scope: 'list' }]);
    // Only handled chords are claimed.
    expect(event.defaultPrevented).toBe(true);
  });

  it('classifies the filter input as text scope — text wins over the list host', async () => {
    await createHarness();
    const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
      'input[aria-label="Filter entries"]',
    );
    assert(input);
    // Plain arrows must type in the filter: text scope ⇒ unclaimed.
    const arrow = press(input, { key: 'ArrowDown' });
    expect(dispatched).toEqual([]);
    expect(arrow.defaultPrevented).toBe(false);
    // …while the every-scope Mod+S still fires from the filter.
    press(input, { key: 's', ctrlKey: true });
    expect(dispatched).toEqual([{ action: 'commit-snapshot', scope: 'text' }]);
  });

  it('classifies a focused row checkbox as list, NOT text', async () => {
    await createHarness();
    // The row checkbox renders input.mdc-checkbox__native-control
    // (type="checkbox") inside the list host. Ctrl+Space only fires in list
    // scope, so the resolution itself pins the classification: had the
    // checkbox classified text, this would be null.
    const input = rowAt(0).querySelector<HTMLInputElement>('input');
    assert(input);
    press(input, { key: ' ', ctrlKey: true });
    expect(dispatched).toEqual([{ action: 'select-toggle', scope: 'list' }]);
  });

  it('classifies editor chrome outside the list as other scope', async () => {
    await createHarness();
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    try {
      // Plain arrows in a textarea stay the caret's (text scope ⇒ unclaimed).
      const arrow = press(textarea, { key: 'ArrowDown' });
      expect(dispatched).toEqual([]);
      expect(arrow.defaultPrevented).toBe(false);
      // A button on the shell (other scope): plain letters do nothing…
      const letter = press(document.body, { key: 'j' });
      expect(dispatched).toEqual([]);
      expect(letter.defaultPrevented).toBe(false);
      // …and plain arrows scroll, never navigate (other ⇒ unclaimed).
      const bodyArrow = press(document.body, { key: 'ArrowDown' });
      expect(dispatched).toEqual([]);
      expect(bodyArrow.defaultPrevented).toBe(false);
    } finally {
      textarea.remove();
    }
  });

  it('leaves unclaimed chords untouched — no preventDefault, no dispatch', async () => {
    await createHarness();
    const unknown = press(rowAt(0), { key: 'F5' });
    const ime = press(rowAt(0), { key: 'ArrowDown', isComposing: true });
    const stray = press(rowAt(0), { key: 'ArrowDown', ctrlKey: true, altKey: true });
    expect(dispatched).toEqual([]);
    expect(unknown.defaultPrevented).toBe(false);
    expect(ime.defaultPrevented).toBe(false);
    expect(stray.defaultPrevented).toBe(false);
  });

  it('is inert while a dialog or bottom sheet is open (overlay gate)', async () => {
    await createHarness();
    overlayOpen = () => true;
    const event = press(document.body, { key: 's', ctrlKey: true });
    expect(dispatched).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
  });

  it('dispatches nothing (and claims nothing) before a handler registers', async () => {
    // The service exists (its listener is live) but nothing registered a
    // dispatcher: a resolved chord must neither dispatch nor claim the key —
    // preventDefault only ever rides a handled action.
    await createHarness([entry(0)], false);
    const event = press(rowAt(0), { key: 'ArrowDown' });
    expect(dispatched).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
  });

  it('tears the document keydown listener down with the injector', async () => {
    await createHarness();
    const document = TestBed.inject(DOCUMENT);
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const handler: ShortcutHandler = (action, scope) => dispatched.push({ action, scope });
    TestBed.inject(KeyboardShortcutsService).register(handler);

    // Resetting the testing module destroys the root injector — the
    // service's DestroyRef must remove the exact listener identity it added.
    TestBed.resetTestingModule();
    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function));

    // Behaviorally: the dead listener never fires again.
    dispatched = [];
    const event = press(document.body, { key: 's', ctrlKey: true });
    expect(dispatched).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
  });
});
