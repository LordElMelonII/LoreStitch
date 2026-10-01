import { DestroyRef, DOCUMENT, Service, inject } from '@angular/core';
import {
  type ShortcutAction,
  type ShortcutKeyEvent,
  type ShortcutScope,
  resolveShortcut,
} from '../../core/models/shortcut-map';
import { ResponsiveOverlayService } from './responsive-overlay.service';

/**
 * Where the app runs, for chord resolution (`Mod` = Cmd on Apple, Ctrl
 * elsewhere). Detected once at construction from the user-agent platform —
 * specs stub `navigator.platform`/`userAgentData.platform` before the
 * service instantiates; jsdom's empty platform classifies as `'other'`.
 */
export type ShortcutPlatform = 'apple' | 'other';

/** The one handler the shell registers (Task 10 §3.2). */
export type ShortcutHandler = (action: ShortcutAction, scope: ShortcutScope) => void;

/**
 * Input types that never classify as text-entry (Task 10 §3.2): a focused
 * row checkbox is `list`, not `text`. Every type NOT in this set (text,
 * search, number, email, …) is typing-capable.
 */
const NON_TEXT_INPUT_TYPES: ReadonlySet<string> = new Set([
  'checkbox',
  'radio',
  'button',
  'submit',
  'file',
  'range',
  'color',
]);

/** True when the element accepts keyboard text input (any type not excluded above). */
function isTextEntryInput(input: HTMLInputElement): boolean {
  return !NON_TEXT_INPUT_TYPES.has(input.type);
}

/**
 * Classifies the keydown's origin element into the resolver's scope. The
 * table below was verified against the rendered Material DOM (Task 10 §3.2,
 * probed 2026-10-01 on the dev server; the service spec pins it):
 *
 * | Focused element                                | Scope   | Because |
 * |------------------------------------------------|---------|---------|
 * | entry row (`.entry-item`, `role="button"`)     | `list`  | inside `app-entry-list` |
 * | row checkbox (`input.mdc-checkbox__native-control`, `type="checkbox"`) | `list` | checkbox is NOT text-entry; inside `app-entry-list` |
 * | filter input (`input[type=text]` in the list)  | `text`  | text wins over list |
 * | editor textarea / name input                   | `text`  | typing-capable |
 * | `mat-select` host (`MAT-SELECT.mat-mdc-select`, `role="combobox"`) | `other` | select owns its arrows/typeahead — even when inside `app-entry-list` |
 * | anything else (document body, buttons, menus)  | `other` | default |
 */
function classifyScope(target: EventTarget | null): ShortcutScope {
  if (!(target instanceof Element)) {
    return 'other';
  }
  // A focused mat-select keeps its native keyboard behavior (the host
  // element — `MAT-SELECT.mat-mdc-select`, role=combobox — is what receives
  // focus; the probe above pinned the class). Checked first so a select
  // inside the entry list never classifies `list`.
  if (target.closest('.mat-mdc-select')) {
    return 'other';
  }
  const isText =
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLInputElement && isTextEntryInput(target)) ||
    (target instanceof HTMLElement && target.isContentEditable);
  if (isText) {
    return 'text';
  }
  if (target.closest('app-entry-list')) {
    return 'list';
  }
  return 'other';
}

/**
 * The user-agent platform read for `detectPlatform` — `userAgentData` on
 * Chromium (not yet in lib.dom, hence the local view), the deprecated-but-
 * universal `platform` property elsewhere.
 */
function userAgentPlatform(nav: Navigator): string {
  const uad = (nav as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  return uad?.platform ?? nav.platform ?? '';
}

function detectPlatform(nav: Navigator | undefined): ShortcutPlatform {
  if (!nav) {
    return 'other';
  }
  return /mac|iphone|ipad|ipod|ios/i.test(userAgentPlatform(nav)) ? 'apple' : 'other';
}

/**
 * The app's single global keydown listener (Task 10 §3.2): classifies each
 * event's scope, consults the pure `resolveShortcut` guard table, and — only
 * on a non-null resolution — claims the key (`preventDefault`) and dispatches
 * it to the one handler the shell registered. Unclaimed chords bubble
 * untouched; the service holds no action logic of its own.
 *
 * Per event, in order:
 * 1. Overlay gate — any open dialog/sheet means Material owns the keys.
 * 2. Scope classification from `event.target` (see `classifyScope`).
 * 3. `resolveShortcut` against the startup platform.
 * 4. Claim + dispatch, or nothing.
 */
@Service()
export class KeyboardShortcutsService {
  private readonly responsiveOverlay = inject(ResponsiveOverlayService);
  private readonly document = inject(DOCUMENT);

  /** The single registered dispatcher; null until the shell registers. */
  private handler: ShortcutHandler | null = null;

  /** Resolved once at startup (Task 10 §3.2 step 3). */
  private readonly platform: ShortcutPlatform = detectPlatform(
    typeof navigator === 'undefined' ? undefined : navigator,
  );

  /**
   * One DOCUMENT keydown listener for the whole app (bubble phase, never
   * passive — a claimed chord calls `preventDefault`). The arrow keeps a
   * stable identity shared by the add/remove pair; DestroyRef tears it down.
   */
  private readonly onKeydown = (event: KeyboardEvent): void => {
    // 1. Overlay gate: an open dialog/sheet means Material owns the keys —
    //    every chord, including Mod+S inside the commit dialog, stays inert.
    if (this.responsiveOverlay.anyOverlayOpen()) {
      return;
    }
    if (!this.handler) {
      return; // Nothing registered: unclaimed — bubble, never preventDefault.
    }
    // 2. Scope from the event's real target (a Document-level listener sees
    //    the focused element here).
    const scope = classifyScope(event.target);
    // 3. The pure guard table adjudicates.
    const eventView: ShortcutKeyEvent = {
      key: event.key,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
      isComposing: event.isComposing,
    };
    const action = resolveShortcut(eventView, scope, this.platform);
    // 4. Null ⇒ unclaimed: let it bubble (never preventDefault). Non-null ⇒
    //    claim the key and dispatch.
    if (action === null) {
      return;
    }
    event.preventDefault();
    this.handler(action, scope);
  };

  constructor() {
    const destroyRef = inject(DestroyRef);
    this.document.addEventListener('keydown', this.onKeydown);
    destroyRef.onDestroy(() => this.document.removeEventListener('keydown', this.onKeydown));
  }

  /**
   * Registers the one dispatcher. The second argument is the invocation
   * scope — Task 10 §3.3's nav/move/select behavior depends on whether the
   * chord fired from the list (focus follows) or elsewhere (focus untouched).
   * A later registration replaces the previous one; there is only ever the
   * shell's.
   */
  register(fn: ShortcutHandler): void {
    this.handler = fn;
  }
}
