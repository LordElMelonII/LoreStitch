# Task 10 — Power-User Keyboard Navigation

> **Source**: ROADMAP.md (LOW PRIORITY) — *"Lorebook maintenance involves
> high-volume data entry; relying exclusively on mouse clicks between sidebar
> lists and inputs causes excessive friction."*
> **Type**: UX friction fix — global shortcut layer over existing controls (no
> new visual controls)
> **Suggested agents**: `core-engine` (lead: pure chord→action model) →
> `ui-specialist` (service, shell routing, focus hooks) → `ts-reviewer` →
> `qa-auditor`
> **Status**: 🟡 Planned — not started

---

## 1. Objective

The five roadmap chords work from anywhere in the studio, claim their browser
defaults deliberately (`preventDefault` only when handled), and never hijack
typing:

| Chord | Action |
|---|---|
| `Mod+S` | Instant VCS snapshot / commit |
| `Mod+N` | New entry, focus its name field |
| `Mod+F` | Focus the sidebar quick-filter |
| `Alt+Up` / `Alt+Down` (and `J`/`K` when the list has focus) | Previous / next entry |
| `Mod+Shift+D` | Toggle the active entry's enabled/disabled status |

(`Mod` = `Ctrl` on Windows/Linux, `Cmd` on macOS. Exact guards in §3.1.)

## 2. Gap analysis (develop @ `ddc9f04`)

There is no shortcut infrastructure at all — the only keydown handling in the
app is `(keydown.enter)` on two form inputs (`new-project-dialog.ts:32`,
`commit-history.html:10`). The mobile bar's charter comment
(`mobile-bottom-bar.ts:54`) claims "keyboard shortcuts" cover the desktop-only
actions — aspirational; nothing implements them. Every action the chords need
already exists as a callable method, which is why this task is wiring, not
feature work:

| Action | Exists at |
|---|---|
| Commit (message required today) | `WorkspaceService.commit(message)` (`workspace.service.ts:407`); commit box + validation `commit-history.ts:52-65` (message required, max 200) |
| New entry (opens its tab) | `WorkspaceService.addEntry()` (`:247`) / `ProjectActionsService.createEntry()` (`project-actions.service.ts:329`) |
| Quick-filter input | `entry-list.html:19-24` (`aria-label="Filter entries"`) |
| Entry navigation source | `EntryList.filtered()` (`entry-list.ts:238`) — the visible order; active entry = `WorkspaceService.activeTabId` |
| Enabled toggle | `updateEntry(id, { enabled })` (`workspace.service.ts:221`; the slide-toggle path via `EntryUpdatesService.setFlag` takes a Material event, so the chord calls the workspace mutator directly) |
| Name field (Ctrl+N focus target) | `entry-name.html` "Name / Comment" input (the `comment` slice — the same field `tabTitle` prefers, `entry-editor.ts:204-207`) |

Gaps the wiring must close: a global keydown owner, a chord→action resolver,
focus entry points on the filter input and the name field (the name input has
no aria-label or hook today), list-row navigation semantics, and the
"instant commit" message convention (the commit form requires a typed
message today — `Mod+S` bypasses the box, so it needs an auto-message).

## 3. Design

### 3.1 Pure resolver — `core/models/shortcut-map.ts`

Bare, framework-free, total (house shape: `st-trigger.ts`). Takes a DOM-ish
event view + a scope, returns the action or `null` — no DOM access inside, so
the whole guard table is unit-testable without a browser.

```ts
export type ShortcutAction =
  | 'commit-snapshot'
  | 'new-entry'
  | 'focus-filter'
  | 'nav-prev'
  | 'nav-next'
  | 'toggle-enabled';

/** Where the event landed: 'text' = input/textarea/contenteditable, 'list' =
 *  the entry sidebar, 'other' = anywhere else (editor chrome, shell, dialogs). */
export type ShortcutScope = 'text' | 'list' | 'other';

export interface ShortcutKeyEvent {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly isComposing: boolean; // IME safety
}

export function resolveShortcut(
  event: ShortcutKeyEvent,
  scope: ShortcutScope,
  platform: 'apple' | 'other',
): ShortcutAction | null;
```

The guard table (the contract checkpoint 10-1 approves):

| Chord | Action | Fires in `text` scope? | Notes |
|---|---|---|---|
| `Mod+S` | `commit-snapshot` | **yes** (saving while drafting is the point) | steals browser Save dialog |
| `Mod+N` | `new-entry` | **yes** | steals browser New Window/Tab |
| `Mod+F` | `focus-filter` | **yes** | steals browser Find |
| `Alt+ArrowUp` / `Alt+ArrowDown` | `nav-prev` / `nav-next` | no | macOS `Option+Up` is a text-editing chord — the `text` guard keeps it safe |
| `J` / `K` (no modifiers) | `nav-next` / `nav-prev` | no — and only in `list` scope | bare letters must always type |
| `Mod+Shift+D` | `toggle-enabled` | no | Chrome's "bookmark all tabs" (both platforms) — claimed with `preventDefault` when it fires |

Additional universal guards: `isComposing` ⇒ `null`; any chord the app does
not claim ⇒ `null` and **no** `preventDefault` (browser behavior untouched);
`Mod` resolves as `metaKey` on `apple`, `ctrlKey` elsewhere (a `Ctrl+S` on
macOS is not a save chord and stays the browser's).

### 3.2 Shortcut service — `shared/services/keyboard-shortcuts.service.ts`

`@Service()` (house naming), root-provided, owning exactly one `DOCUMENT`
keydown listener (bubble phase; `preventDefault`/`stopPropagation` called only
for a non-null resolution). It computes `ShortcutScope` from `event.target`
(the `text` predicate: `input`/`textarea`/`[contenteditable]`; `list`: target
inside the `app-entry-list` host) and `platform` once at startup, calls
`resolveShortcut`, and hands the action to registered handlers. Dispatch
follows the Task 06 shell-routing precedent (`app.ts` `runBarAction` /
`runBatchBarAction`, exhaustive `never` switch):

- workspace actions (`commit-snapshot`, `new-entry`, `toggle-enabled`) route
  to `WorkspaceService`/`ProjectActionsService` directly from the handler;
- view actions (`focus-filter`, `nav-prev`, `nav-next`) route through `App`'s
  `viewChild(EntryList)` public methods — the bar-contract pattern
  (`selectionCount` et al., `entry-list.ts:261-285`) extended with
  `focusFilter()`, `navigate(delta: -1 | 1)`.

### 3.3 Action semantics

- **`commit-snapshot`**: `WorkspaceService.commit(<auto-message>)` when
  `hasUnsavedChanges()`; when the tree matches HEAD, a one-line snackbar
  ("Nothing to commit.") and no empty commit (the content-addressed hash
  chain would still produce a new id for an unchanged book — history noise).
  Auto-message: `Snapshot · <local yyyy-mm-dd hh:mm>` — final format at
  checkpoint 10-1 (the history list renders it verbatim,
  `commit-history.html:57`). Success feedback: snackbar with the short hash
  (`shortHash`, `vcs.service.ts:6`).
- **`new-entry`**: `workspace.addEntry()`, then focus the name input **of the
  active tab body** (`EntryEditor.focusNameField()` — a public method
  querying `.mat-mdc-tab-body-active` scoped input). The AGENTS.md e2e lesson
  applies to the implementation too: inactive mat-tabs keep their inputs in
  the DOM, so an unscoped query focuses a hidden field. The input gains
  `aria-label="Entry name"` (stable hook + `getByLabel` fixity).
- **`focus-filter`**: `EntryList.focusFilter()` — focuses + selects the filter
  input (`entry-list.html:19`). On phones the sidebar may be closed: opening
  the entries drawer first is out of scope (the chord set is for
  keyboard-carrying viewports; the input simply no-ops when unmounted —
  state in the hint copy only if one is added later).
- **`nav-prev` / `nav-next`**: move the active entry through `filtered()`
  order from `activeTabId` (wrap disabled — clamp at the ends), `openEntry`
  the target (`workspace.service.ts:387` — opening is idempotent and sets the
  active tab), and bring its row into view (`EntryList.scrollToEntry`
  precedent, `entry-list.ts:367`, made callable from `navigate`). `J`/`K`
  additionally move DOM focus to the reached row so the next `J`/`K` keeps
  firing in `list` scope (row focusability is the one small UI change: a
  roving `tabindex` on the row's open target).
- **`toggle-enabled`**: flip `enabled` on `activeTabId`'s entry via
  `updateEntry`; no active entry ⇒ snackbar "Open an entry first." (copy at
  checkpoint).

### 3.6 Test matrix

| Tier | Required cases |
|------|----------------|
| Unit — `shortcut-map.spec.ts` | full guard table × scope × platform (including: `J` in `text` scope ⇒ null; `Alt+ArrowUp` in `text` ⇒ null; `Ctrl+S` on `apple` ⇒ null; `Cmd+S` on `apple` ⇒ commit; IME composing ⇒ null; unknown chords never resolve) |
| Unit — `keyboard-shortcuts.service.spec.ts` | scope detection from real DOM targets (`installMatchMediaStub` house fixture irrelevant here — plain TestBed + dispatched KeyboardEvents); `preventDefault` called only on handled chords (assert on a spy event) |
| Unit — action semantics | commit auto-message shape + no-commit-on-clean; toggle with/without active entry |
| E2E — new `e2e/keyboard-shortcuts.spec.ts` | `Mod+S` creates a commit row without the box (typed message absent ⇒ auto-message visible in history); `Mod+N` appends a row and the **active tab body's** name input has focus (`page.evaluate` activeElement check); `Mod+F` focuses the filter; `Alt+ArrowDown`/`J` moves the active row; typing `jk` in the filter input inserts letters (the no-hijack pin); `Mod+Shift+D` flips the row's disabled state |
| Existing specs | none pin keyboard behavior (§2) — but any spec typing `j`/`k`/`d` through real inputs must stay green (they exercise the `text`-scope guard for free) |

**Visual gate**: none — no control is added or reshaped (the row roving
`tabindex` in §3.3 is focus-only chrome). The shortcut map is still a
behavior contract ⇒ checkpoint 10-1 (below), not a design-evidence gate.

## 4. Implementation Plan

| Phase | Files | Work |
|-------|-------|------|
| **P1 — Resolver** (core-engine) | `core/models/shortcut-map.ts` (+spec), `core/models/README.md` | §3.1 |
| **Checkpoint 10-1** (user) | — | chord table + guards + auto-message + snackbar copy (§3.3) as a behavior contract |
| **P2 — Wiring** (ui-specialist) | `shared/services/keyboard-shortcuts.service.ts` (+spec), `app.ts`, `entry-list.ts/.html`, `entry-editor.ts`, `entry-name/entry-name.html`, `workspace.service.ts` (none — actions are existing methods) | §3.2 + §3.3 |
| **P3 — Review** (ts-reviewer) | all touched | exhaustive action unions, listener teardown via `DestroyRef`, signal purity in `navigate` |
| **P4 — E2E** (qa-auditor) | `e2e/keyboard-shortcuts.spec.ts` | §3.6 |

Commits: `feat(shortcuts): power-user keyboard navigation`, `test(e2e): …`,
`docs(next_tasks): …`.

## 5. Orchestration

1. **`core-engine`** — P1 (skills: `typescript-advanced-types`). *Gate:
   `npm test`.*
2. **User checkpoint 10-1** — the chord/guard/auto-message contract. Gate
   stays open until answered (house rule).
3. **`ui-specialist`** — P2 (skills: `material-3`, `angular-developer`).
   *Gate: `npm test` + `npm run build`.*
4. **`ts-reviewer`** — P3. *Gate: `npm run lint`.*
5. **`qa-auditor`** — P4 (skills: `playwright-cli`). *Gate: `npx playwright
   test keyboard-shortcuts` green on desktop-chrome + one mobile project
   (mobile: chords are inert, bar covers the actions — pin that the bar still
   works and nothing crashes on keydown).*

## 6. Verification Gates

`npm run build` · `npm test` · `ng test --coverage` (`shortcut-map` +
service covered) · `npx playwright test keyboard-shortcuts ui-responsiveness`
· `npm run lint`.

## 7. Risks & Open Questions

1. **Browser chord collisions** (`Mod+N`, `Mod+F`, `Mod+Shift+D`): the chords
   are claimed with `preventDefault` — including `Mod+Shift+D` = Chrome's
   bookmark-all-tabs. Users who want that browser action lose it in-app;
   this is inherent to the roadmap's chosen map (checkpoint 10-1 states it
   plainly).
2. **`Mod+S` on a page with a pending form**: saves from inside text fields by
   design. It commits the *working tree* (all entries), not "the current
   field" — flush semantics come free (`commit` → `storage.saveProject`,
   `workspace.service.ts:413`).
3. **Auto-message noise in history**: rapid `Mod+S` presses create many tiny
   snapshots. Acceptable (history is cheap, rollback is O(1)); if the user
   wants a cooldown or clean-tree suppression beyond §3.3, that is a
   checkpoint-10-1 answer, not a design change.
4. **`J`/`K` list-focus definition**: "when list is focused" resolves to
   `event.target` inside `app-entry-list` — including the filter input, where
   bare letters must type (the `text` guard wins over `list`). A future
   row-level focus ring may want `K` from the editor itself; out of scope.
5. **Ctrl+Z interplay (Task 12 candidate)**: this task claims no editing
   chords (`Mod+Z`/`Mod+Shift+Z` untouched) so the undo/redo task inherits a
   clean map.
