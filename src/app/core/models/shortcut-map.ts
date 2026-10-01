/**
 * Power-user keyboard chord map (Task 10 §3.1) — the single source of truth
 * for the app's global shortcut layer.
 *
 * `resolveShortcut` is the total, pure guard table the keyboard-shortcuts
 * service consults per keydown, and `SHORTCUTS_HELP` is the catalog the
 * shortcuts help dialog (Task 10 §3.6) renders. Both derive from the same
 * §3.1 contract on purpose: the runtime guards and the user-facing help can
 * never drift, and the unit spec pins one help entry per `ShortcutAction`,
 * grouped consistently with the §3.1 scope columns.
 *
 * The resolver takes a DOM-ish event *view* rather than a DOM `KeyboardEvent`
 * so the whole guard table is unit-testable without a browser and this module
 * stays framework-free. A `null` return means "unclaimed": the caller must
 * let the event bubble and never call `preventDefault` on it. Guards, in
 * evaluation order:
 *
 * 1. `isComposing` ⇒ `null` — a composition in flight owns every key (IME
 *    safety; no shortcut may fire mid-composition).
 * 2. `Mod` = `metaKey` on platform `'apple'`, `ctrlKey` elsewhere; the other
 *    key of the pair is a stray modifier. `Ctrl+S` on macOS stays the
 *    browser's, and `Cmd+S` on Windows/Linux is unclaimed.
 * 3. Any chord pressed with an extra modifier beyond its own ⇒ `null`
 *    (`Mod+S+Alt`, `Shift+J`, `Ctrl+Alt+↑`… all unclaimed).
 * 4. `Mod+S` / `Mod+N` / `Mod+F` fire in every scope, `'text'` included —
 *    saving and creating while drafting is the point; each also steals a
 *    browser default (Save, New Window, Find) by design.
 * 5. Everything else never fires in `'text'` scope: Alt/Shift+arrows,
 *    `Mod+Shift+D` and `?` must type there. (macOS `Option+↑` is a text
 *    navigation chord — the `text` guard keeps it safe.)
 * 6. `?` is `key === '?'` with no Mod and no Alt; Shift is allowed because
 *    typing `?` needs Shift on most layouts. On AltGr-class layouts the no-Alt
 *    guard rejects it (the `Mod+/` alias is a checkpoint option, not landed).
 * 7. The list-only chords — plain ↑/↓ and J/K, `Ctrl+Space`, `Shift+↑/↓` —
 *    fire only in `'list'` scope: bare letters must always type, and
 *    `Ctrl+Space` as an OS/IME toggle is safe because `'list'` excludes text
 *    fields. `Ctrl+Space` is literal Ctrl on every platform (`Cmd+Space` is
 *    Spotlight on macOS and stays unclaimed).
 * 8. J/K match case-insensitively (`j`/`J`, `k`/`K`) — Caps Lock does not set
 *    `shiftKey`, and a shifted J is a stray-modifier chord ⇒ `null`.
 *
 * Unclaimed chords (unknown keys, F5, `Mod+P`, …) ⇒ `null`. Scope and
 * platform classification live with the caller (the shortcut service); this
 * module only adjudicates.
 */

/** One dispatchable shortcut outcome. Exhaustive — `never`-switch on it. */
export type ShortcutAction =
  | 'commit-snapshot'
  | 'new-entry'
  | 'focus-filter'
  | 'nav-prev'
  | 'nav-next'
  | 'move-up'
  | 'move-down'
  | 'toggle-enabled'
  | 'select-toggle'
  | 'select-extend-prev'
  | 'select-extend-next'
  | 'show-help';

/**
 * Where the keydown originated. `'text'` = typing-capable element,
 * `'list'` = inside the entry sidebar (and not text), `'other'` = anywhere
 * else. Classification is the shortcut service's job (Task 10 §3.2).
 */
export type ShortcutScope = 'text' | 'list' | 'other';

/** The subset of a DOM `KeyboardEvent` the guard table reads. */
export interface ShortcutKeyEvent {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  /** IME safety: `true` claims every key for the composition. */
  readonly isComposing: boolean;
}

/**
 * Resolves a keydown to its shortcut action, or `null` when the chord is
 * unclaimed. Total and pure: the event is only read, never mutated, and
 * every input combination yields a verdict — the full §3.1 guard table is
 * unit-testable without a browser.
 */
export function resolveShortcut(
  event: ShortcutKeyEvent,
  scope: ShortcutScope,
  platform: 'apple' | 'other',
): ShortcutAction | null {
  // Universal guard first: a composition in flight owns every key.
  if (event.isComposing) {
    return null;
  }

  const mod = platform === 'apple' ? event.metaKey : event.ctrlKey;
  // The platform's non-Mod command key; pressing it alongside any chord is a
  // stray modifier (Ctrl+S on macOS, Cmd+S on Windows/Linux, …).
  const otherMod = platform === 'apple' ? event.ctrlKey : event.metaKey;
  const { altKey, shiftKey } = event;
  // Letters match case-insensitively (s/S, n/N, f/F, d/D, j/J, k/K); the
  // multi-char key names ('ArrowUp', 'F5', …) compare verbatim.
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;

  // Ctrl+Space — literal Ctrl on every platform, no other modifier, list
  // scope only. Adjudicated before the Mod+letter block, which would
  // otherwise swallow the exact-Ctrl chord as an unclaimed Mod chord
  // (Cmd+Space on macOS is Spotlight and stays unclaimed).
  if (scope === 'list' && event.ctrlKey && !event.metaKey && !altKey && !shiftKey && key === ' ') {
    return 'select-toggle';
  }

  // Mod+S / Mod+N / Mod+F — exactly Mod, no more — fire in every scope.
  if (mod && !otherMod && !altKey && !shiftKey) {
    if (key === 's') {
      return 'commit-snapshot';
    }
    if (key === 'n') {
      return 'new-entry';
    }
    if (key === 'f') {
      return 'focus-filter';
    }
    return null; // Mod+<anything else> stays the browser's.
  }

  // Every remaining chord must type in a text field.
  if (scope === 'text') {
    return null;
  }

  // Mod+Shift+D — toggle the active entry's enabled state (Chrome's
  // bookmark-all-tabs on both platforms; claimed).
  if (mod && !otherMod && !altKey && shiftKey && key === 'd') {
    return 'toggle-enabled';
  }

  // Alt+arrows navigate, Alt+Shift+arrows reorder ('list' + 'other'; the
  // macOS Option+arrow text chords stay safe behind the 'text' guard).
  if (altKey && !mod && !otherMod) {
    if (key === 'ArrowUp') {
      return shiftKey ? 'move-up' : 'nav-prev';
    }
    if (key === 'ArrowDown') {
      return shiftKey ? 'move-down' : 'nav-next';
    }
    return null; // Alt+<anything else> is unclaimed.
  }

  // `?` opens the shortcuts help dialog; Shift allowed (typing `?` needs it
  // on most layouts), Mod/Alt stay stray.
  if (key === '?' && !mod && !otherMod && !altKey) {
    return 'show-help';
  }

  // List-only chords: the roving entry list's native keys. In 'other' scope
  // they must all stay unclaimed (plain arrows scroll, letters do nothing).
  if (scope !== 'list') {
    return null;
  }

  // With Mod/Ctrl held, nothing in the list is ours (e.g. Ctrl+Alt+↑ must
  // not fall through to the plain-arrow match below).
  if (mod || otherMod || event.ctrlKey) {
    return null;
  }

  if (!shiftKey) {
    // Plain arrows and vim-style J/K move the roving focus (J is next,
    // K is previous — matching the §1.1 table).
    if (key === 'ArrowUp') {
      return 'nav-prev';
    }
    if (key === 'ArrowDown') {
      return 'nav-next';
    }
    if (key === 'j') {
      return 'nav-next';
    }
    if (key === 'k') {
      return 'nav-prev';
    }
    return null;
  }

  // Shift+arrows extend the selection from the anchor (task 20 parity).
  if (key === 'ArrowUp') {
    return 'select-extend-prev';
  }
  if (key === 'ArrowDown') {
    return 'select-extend-next';
  }
  return null;
}

/** One row of the shortcuts help dialog (Task 10 §3.6). */
export interface ShortcutHelpEntry {
  /** Display chord, e.g. `'Mod+S'` (Mod = Ctrl on Windows/Linux, Cmd on macOS). */
  readonly chord: string;
  readonly action: ShortcutAction;
  /** One-line, writer-facing description. */
  readonly description: string;
  /** `'global'` renders under "Everywhere", `'list'` under "In the entry list". */
  readonly group: 'global' | 'list';
}

/**
 * The §3.1 table as user-facing help: exactly one entry per
 * `ShortcutAction`, in table order. Actions that fire only in `'list'`
 * scope group as `'list'`; everything else is `'global'`. Kept beside
 * `resolveShortcut` so the help dialog can never disagree with the guards —
 * the unit spec pins the completeness.
 */
export const SHORTCUTS_HELP: readonly ShortcutHelpEntry[] = [
  {
    chord: 'Mod+S',
    action: 'commit-snapshot',
    description: 'Commit an instant snapshot of the book.',
    group: 'global',
  },
  {
    chord: 'Mod+N',
    action: 'new-entry',
    description: 'Create a new entry and focus its name field.',
    group: 'global',
  },
  {
    chord: 'Mod+F',
    action: 'focus-filter',
    description: 'Focus the sidebar quick-filter.',
    group: 'global',
  },
  {
    chord: 'K / ↑',
    action: 'nav-prev',
    description: 'Open the previous entry (focus follows from the list).',
    group: 'global',
  },
  {
    chord: 'J / ↓',
    action: 'nav-next',
    description: 'Open the next entry (focus follows from the list).',
    group: 'global',
  },
  {
    chord: 'Alt+Shift+↑',
    action: 'move-up',
    description: 'Move the active entry one visible position up.',
    group: 'global',
  },
  {
    chord: 'Alt+Shift+↓',
    action: 'move-down',
    description: 'Move the active entry one visible position down.',
    group: 'global',
  },
  {
    chord: 'Mod+Shift+D',
    action: 'toggle-enabled',
    description: "Toggle the active entry's enabled state.",
    group: 'global',
  },
  {
    chord: 'Ctrl+Space',
    action: 'select-toggle',
    description: 'Toggle selection of the focused row.',
    group: 'list',
  },
  {
    chord: 'Shift+↑',
    action: 'select-extend-prev',
    description: 'Extend the selection up from the anchor.',
    group: 'list',
  },
  {
    chord: 'Shift+↓',
    action: 'select-extend-next',
    description: 'Extend the selection down from the anchor.',
    group: 'list',
  },
  {
    chord: '?',
    action: 'show-help',
    description: 'Open the keyboard shortcuts help dialog.',
    group: 'global',
  },
];
