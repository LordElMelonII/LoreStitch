import {
  resolveShortcut,
  SHORTCUTS_HELP,
  type ShortcutAction,
  type ShortcutKeyEvent,
  type ShortcutScope,
} from './shortcut-map';

/**
 * Every action of the §3.1 union, in table order — the baseline the help
 * catalog's completeness is pinned against. A new `ShortcutAction` without a
 * `SHORTCUTS_HELP` entry fails here.
 */
const ALL_ACTIONS: readonly ShortcutAction[] = [
  'commit-snapshot',
  'new-entry',
  'focus-filter',
  'nav-prev',
  'nav-next',
  'move-up',
  'move-down',
  'toggle-enabled',
  'select-toggle',
  'select-extend-prev',
  'select-extend-next',
  'show-help',
];

const SCOPES: readonly ShortcutScope[] = ['text', 'list', 'other'];
const PLATFORMS = ['apple', 'other'] as const;

/** A plain unmodified keydown view, overridden per test. */
function keyEvent(partial: Partial<ShortcutKeyEvent>): ShortcutKeyEvent {
  return {
    key: '',
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    isComposing: false,
    ...partial,
  };
}

describe('shortcut-map', () => {
  describe('resolveShortcut', () => {
    describe('Mod+S / Mod+N / Mod+F — every scope, both platforms', () => {
      const MOD_CHORDS = [
        { label: 'Mod+S', letter: 's', action: 'commit-snapshot' },
        { label: 'Mod+N', letter: 'n', action: 'new-entry' },
        { label: 'Mod+F', letter: 'f', action: 'focus-filter' },
      ] as const;

      for (const chord of MOD_CHORDS) {
        it(`resolves ${chord.label} (Ctrl) in every scope on the non-apple platform`, () => {
          for (const scope of SCOPES) {
            expect(
              resolveShortcut(keyEvent({ key: chord.letter, ctrlKey: true }), scope, 'other'),
            ).toBe(chord.action);
          }
        });

        it(`resolves ${chord.label} (Cmd/metaKey) in every scope on apple`, () => {
          for (const scope of SCOPES) {
            expect(
              resolveShortcut(keyEvent({ key: chord.letter, metaKey: true }), scope, 'apple'),
            ).toBe(chord.action);
          }
        });

        it(`leaves Ctrl+${chord.letter.toUpperCase()} unclaimed on apple — it stays the browser's`, () => {
          for (const scope of SCOPES) {
            expect(
              resolveShortcut(keyEvent({ key: chord.letter, ctrlKey: true }), scope, 'apple'),
            ).toBeNull();
          }
        });

        it(`leaves Cmd+${chord.letter.toUpperCase()} (metaKey) unclaimed on the non-apple platform`, () => {
          for (const scope of SCOPES) {
            expect(
              resolveShortcut(keyEvent({ key: chord.letter, metaKey: true }), scope, 'other'),
            ).toBeNull();
          }
        });
      }
    });

    describe('Alt+arrows — navigate, never in text', () => {
      it('resolves Alt+↑/↓ as nav in list and other scope on both platforms', () => {
        expect(resolveShortcut(keyEvent({ key: 'ArrowUp', altKey: true }), 'list', 'other')).toBe(
          'nav-prev',
        );
        expect(resolveShortcut(keyEvent({ key: 'ArrowDown', altKey: true }), 'list', 'other')).toBe(
          'nav-next',
        );
        expect(resolveShortcut(keyEvent({ key: 'ArrowUp', altKey: true }), 'other', 'other')).toBe(
          'nav-prev',
        );
        expect(
          resolveShortcut(keyEvent({ key: 'ArrowDown', altKey: true }), 'other', 'other'),
        ).toBe('nav-next');
        expect(resolveShortcut(keyEvent({ key: 'ArrowUp', altKey: true }), 'list', 'apple')).toBe(
          'nav-prev',
        );
        expect(
          resolveShortcut(keyEvent({ key: 'ArrowDown', altKey: true }), 'other', 'apple'),
        ).toBe('nav-next');
      });

      it('leaves Alt+arrows unclaimed in text scope (macOS Option+arrows are text chords)', () => {
        for (const platform of PLATFORMS) {
          expect(
            resolveShortcut(keyEvent({ key: 'ArrowUp', altKey: true }), 'text', platform),
          ).toBeNull();
          expect(
            resolveShortcut(keyEvent({ key: 'ArrowDown', altKey: true }), 'text', platform),
          ).toBeNull();
        }
      });
    });

    describe('plain arrows — list only', () => {
      it('resolves bare ↑/↓ as nav in list scope', () => {
        expect(resolveShortcut(keyEvent({ key: 'ArrowUp' }), 'list', 'other')).toBe('nav-prev');
        expect(resolveShortcut(keyEvent({ key: 'ArrowDown' }), 'list', 'other')).toBe('nav-next');
      });

      it('leaves plain arrows unclaimed outside list scope', () => {
        for (const scope of ['text', 'other'] as const) {
          expect(resolveShortcut(keyEvent({ key: 'ArrowUp' }), scope, 'other')).toBeNull();
          expect(resolveShortcut(keyEvent({ key: 'ArrowDown' }), scope, 'other')).toBeNull();
        }
      });
    });

    describe('J/K — list only, case-insensitive', () => {
      it('resolves J as nav-next and K as nav-prev in list scope, in both cases', () => {
        expect(resolveShortcut(keyEvent({ key: 'j' }), 'list', 'other')).toBe('nav-next');
        expect(resolveShortcut(keyEvent({ key: 'J' }), 'list', 'other')).toBe('nav-next');
        expect(resolveShortcut(keyEvent({ key: 'k' }), 'list', 'other')).toBe('nav-prev');
        expect(resolveShortcut(keyEvent({ key: 'K' }), 'list', 'apple')).toBe('nav-prev');
      });

      it('leaves bare letters unclaimed outside list scope — they must type', () => {
        for (const scope of ['text', 'other'] as const) {
          for (const letter of ['j', 'J', 'k', 'K']) {
            expect(resolveShortcut(keyEvent({ key: letter }), scope, 'other')).toBeNull();
          }
        }
      });
    });

    describe('Alt+Shift+arrows — move the active entry, never in text', () => {
      it('resolves Alt+Shift+↑/↓ as move in list and other scope on both platforms', () => {
        expect(
          resolveShortcut(
            keyEvent({ key: 'ArrowUp', altKey: true, shiftKey: true }),
            'list',
            'other',
          ),
        ).toBe('move-up');
        expect(
          resolveShortcut(
            keyEvent({ key: 'ArrowDown', altKey: true, shiftKey: true }),
            'list',
            'other',
          ),
        ).toBe('move-down');
        expect(
          resolveShortcut(
            keyEvent({ key: 'ArrowUp', altKey: true, shiftKey: true }),
            'other',
            'other',
          ),
        ).toBe('move-up');
        expect(
          resolveShortcut(
            keyEvent({ key: 'ArrowDown', altKey: true, shiftKey: true }),
            'other',
            'apple',
          ),
        ).toBe('move-down');
      });

      it('leaves Alt+Shift+arrows unclaimed in text scope', () => {
        for (const platform of PLATFORMS) {
          expect(
            resolveShortcut(
              keyEvent({ key: 'ArrowUp', altKey: true, shiftKey: true }),
              'text',
              platform,
            ),
          ).toBeNull();
          expect(
            resolveShortcut(
              keyEvent({ key: 'ArrowDown', altKey: true, shiftKey: true }),
              'text',
              platform,
            ),
          ).toBeNull();
        }
      });
    });

    describe('Mod+Shift+D — toggle enabled, never in text', () => {
      it('resolves Mod+Shift+D in list and other scope on both platforms', () => {
        expect(
          resolveShortcut(keyEvent({ key: 'd', ctrlKey: true, shiftKey: true }), 'list', 'other'),
        ).toBe('toggle-enabled');
        expect(
          resolveShortcut(keyEvent({ key: 'd', ctrlKey: true, shiftKey: true }), 'other', 'other'),
        ).toBe('toggle-enabled');
        expect(
          resolveShortcut(keyEvent({ key: 'd', metaKey: true, shiftKey: true }), 'other', 'apple'),
        ).toBe('toggle-enabled');
      });

      it('leaves Mod+Shift+D unclaimed in text scope', () => {
        for (const platform of PLATFORMS) {
          expect(
            resolveShortcut(
              keyEvent({ key: 'd', ctrlKey: true, shiftKey: true }),
              'text',
              platform,
            ),
          ).toBeNull();
          expect(
            resolveShortcut(
              keyEvent({ key: 'd', metaKey: true, shiftKey: true }),
              'text',
              platform,
            ),
          ).toBeNull();
        }
      });

      it('leaves Ctrl+Shift+D unclaimed on apple — ctrlKey is not Mod there', () => {
        expect(
          resolveShortcut(keyEvent({ key: 'd', ctrlKey: true, shiftKey: true }), 'other', 'apple'),
        ).toBeNull();
      });
    });

    describe('Ctrl+Space — select toggle, list only, literal Ctrl', () => {
      it('resolves Ctrl+Space in list scope on both platforms', () => {
        expect(resolveShortcut(keyEvent({ key: ' ', ctrlKey: true }), 'list', 'other')).toBe(
          'select-toggle',
        );
        expect(resolveShortcut(keyEvent({ key: ' ', ctrlKey: true }), 'list', 'apple')).toBe(
          'select-toggle',
        );
      });

      it('leaves Ctrl+Space unclaimed in text and other scope', () => {
        for (const scope of ['text', 'other'] as const) {
          expect(resolveShortcut(keyEvent({ key: ' ', ctrlKey: true }), scope, 'other')).toBeNull();
          expect(resolveShortcut(keyEvent({ key: ' ', ctrlKey: true }), scope, 'apple')).toBeNull();
        }
      });

      it('leaves Cmd+Space unclaimed on apple (Spotlight)', () => {
        expect(resolveShortcut(keyEvent({ key: ' ', metaKey: true }), 'list', 'apple')).toBeNull();
      });
    });

    describe('Shift+arrows — extend selection, list only', () => {
      it('resolves Shift+↑/↓ as select-extend in list scope', () => {
        expect(resolveShortcut(keyEvent({ key: 'ArrowUp', shiftKey: true }), 'list', 'other')).toBe(
          'select-extend-prev',
        );
        expect(
          resolveShortcut(keyEvent({ key: 'ArrowDown', shiftKey: true }), 'list', 'other'),
        ).toBe('select-extend-next');
      });

      it('leaves Shift+arrows unclaimed outside list scope', () => {
        for (const scope of ['text', 'other'] as const) {
          expect(
            resolveShortcut(keyEvent({ key: 'ArrowUp', shiftKey: true }), scope, 'other'),
          ).toBeNull();
          expect(
            resolveShortcut(keyEvent({ key: 'ArrowDown', shiftKey: true }), scope, 'other'),
          ).toBeNull();
        }
      });
    });

    describe('? — show help, never in text', () => {
      it('resolves ? in list and other scope', () => {
        expect(resolveShortcut(keyEvent({ key: '?' }), 'list', 'other')).toBe('show-help');
        expect(resolveShortcut(keyEvent({ key: '?' }), 'other', 'other')).toBe('show-help');
      });

      it('resolves ? typed with Shift — the natural chord on most layouts', () => {
        expect(resolveShortcut(keyEvent({ key: '?', shiftKey: true }), 'list', 'other')).toBe(
          'show-help',
        );
        expect(resolveShortcut(keyEvent({ key: '?', shiftKey: true }), 'other', 'other')).toBe(
          'show-help',
        );
      });

      it('leaves ? unclaimed in text scope — it must type', () => {
        expect(resolveShortcut(keyEvent({ key: '?' }), 'text', 'other')).toBeNull();
        expect(resolveShortcut(keyEvent({ key: '?', shiftKey: true }), 'text', 'other')).toBeNull();
      });

      it('leaves ? with Mod or Alt unclaimed', () => {
        expect(resolveShortcut(keyEvent({ key: '?', ctrlKey: true }), 'other', 'other')).toBeNull();
        expect(resolveShortcut(keyEvent({ key: '?', metaKey: true }), 'other', 'apple')).toBeNull();
        expect(resolveShortcut(keyEvent({ key: '?', altKey: true }), 'other', 'other')).toBeNull();
      });
    });

    describe('universal guards', () => {
      it('returns null while isComposing, even for Mod+S, on both platforms', () => {
        expect(
          resolveShortcut(
            keyEvent({ key: 's', ctrlKey: true, isComposing: true }),
            'other',
            'other',
          ),
        ).toBeNull();
        expect(
          resolveShortcut(
            keyEvent({ key: 's', metaKey: true, isComposing: true }),
            'text',
            'apple',
          ),
        ).toBeNull();
        expect(
          resolveShortcut(keyEvent({ key: 'ArrowDown', isComposing: true }), 'list', 'other'),
        ).toBeNull();
      });

      it('rejects stray-modifier chords', () => {
        // Mod+S+Alt on both platforms.
        expect(
          resolveShortcut(keyEvent({ key: 's', ctrlKey: true, altKey: true }), 'other', 'other'),
        ).toBeNull();
        expect(
          resolveShortcut(keyEvent({ key: 's', metaKey: true, altKey: true }), 'other', 'apple'),
        ).toBeNull();
        // J+Shift in list — a shifted letter must never fire.
        expect(resolveShortcut(keyEvent({ key: 'j', shiftKey: true }), 'list', 'other')).toBeNull();
        // Mod+Shift+D+Alt on both platforms.
        expect(
          resolveShortcut(
            keyEvent({ key: 'd', ctrlKey: true, shiftKey: true, altKey: true }),
            'other',
            'other',
          ),
        ).toBeNull();
        expect(
          resolveShortcut(
            keyEvent({ key: 'd', metaKey: true, shiftKey: true, altKey: true }),
            'list',
            'apple',
          ),
        ).toBeNull();
        // Ctrl+Alt+↑ must not fall through to the plain-arrow match.
        expect(
          resolveShortcut(
            keyEvent({ key: 'ArrowUp', ctrlKey: true, altKey: true }),
            'list',
            'other',
          ),
        ).toBeNull();
        // Ctrl+Cmd+S is a stray chord on both platforms.
        expect(
          resolveShortcut(keyEvent({ key: 's', ctrlKey: true, metaKey: true }), 'other', 'other'),
        ).toBeNull();
        expect(
          resolveShortcut(keyEvent({ key: 's', ctrlKey: true, metaKey: true }), 'other', 'apple'),
        ).toBeNull();
      });

      it('leaves unknown chords unclaimed', () => {
        expect(resolveShortcut(keyEvent({ key: 'x' }), 'list', 'other')).toBeNull();
        expect(resolveShortcut(keyEvent({ key: 'F5' }), 'other', 'other')).toBeNull();
        expect(resolveShortcut(keyEvent({ key: 'p', ctrlKey: true }), 'other', 'other')).toBeNull();
        expect(resolveShortcut(keyEvent({ key: 'p', metaKey: true }), 'other', 'apple')).toBeNull();
        expect(resolveShortcut(keyEvent({ key: 'Home' }), 'list', 'other')).toBeNull();
      });
    });
  });

  describe('SHORTCUTS_HELP', () => {
    it('carries exactly one entry per ShortcutAction, in §3.1 table order', () => {
      expect(SHORTCUTS_HELP.map((entry) => entry.action)).toEqual(ALL_ACTIONS);
    });

    it('groups list-only actions as list and everything else as global', () => {
      const byAction = new Map(SHORTCUTS_HELP.map((entry) => [entry.action, entry]));
      for (const action of ALL_ACTIONS) {
        const entry = byAction.get(action);
        expect(entry, `missing help entry for ${action}`).toBeDefined();
        const expected =
          action === 'select-toggle' ||
          action === 'select-extend-prev' ||
          action === 'select-extend-next'
            ? 'list'
            : 'global';
        expect(entry?.group, `${action} group`).toBe(expected);
      }
    });

    it('gives every entry a chord and a one-line description', () => {
      for (const entry of SHORTCUTS_HELP) {
        expect(entry.chord.length, `chord for ${entry.action}`).toBeGreaterThan(0);
        expect(entry.description.length, `description for ${entry.action}`).toBeGreaterThan(0);
        expect(entry.description).not.toContain('\n');
      }
    });
  });
});
