# Task 10 — Power-User Keyboard Navigation & Keyboard Accessibility

> **Source**: ROADMAP.md (LOW PRIORITY) — *"Lorebook maintenance involves
> high-volume data entry; relying exclusively on mouse clicks between sidebar
> lists and inputs causes excessive friction."* **Rescoped 2026-10-01** (user
> decision, final task): absorbs the keyboard-side items from the 2026-09-22
> app review — keyboard range selection, keyboard reorder,
> destructive-action confirmations — plus the mechanical focus/ARIA fixes
> found by the 2026-10-01 keyboard/a11y sweep. The full listbox/option row
> restructure was **declined** at the same session (roving tabindex over the
> existing `role="button"` rows instead).
> **Type**: UX friction + accessibility pass — global shortcut layer over
> existing actions, keyboard semantics for the entry list, a shortcuts help
> dialog (added 2026-10-01, user decision — discoverability cannot be
> assumed), and one small visible-UI delta set (focus rings, skip link, two
> confirm dialogs) ⇒ design evidence at checkpoint 10-1.
> **Suggested agents**: `core-engine` (lead: pure chord→action model) →
> `ui-specialist` (two phases) → `ts-reviewer` → `qa-auditor`
> **Status**: 🟡 Planned — not started (re-grounded at `develop` @ `90bb582`,
> v1.11.0)

---

## 1. Objective

### 1.1 Chords

| Chord | Action | Fires from |
|---|---|---|
| `Mod+S` | Instant snapshot commit (auto-message) | anywhere |
| `Mod+N` | New entry + focus its name field | anywhere |
| `Mod+F` | Focus the sidebar quick-filter | anywhere |
| `Alt+↑` / `Alt+↓` | Previous / next entry — active entry moves, DOM focus untouched | anywhere but text |
| `J` / `K` | Next / previous entry — DOM focus moves with the row | list focus only |
| `↑` / `↓` | Same as `J`/`K` (natural arrows for the roving list) | list focus only |
| `Alt+Shift+↑` / `Alt+Shift+↓` | Move the active entry one **visible** position up/down | anywhere but text |
| `Mod+Shift+D` | Toggle the active entry's enabled state | anywhere but text |
| `Ctrl+Space` | Toggle selection of the focused row | list focus only |
| `Shift+↑` / `Shift+↓` | Extend the selection from the anchor | list focus only |
| `?` | Open the keyboard-shortcuts help dialog (§3.6) | anywhere but text |

(`Mod` = `Ctrl` on Windows/Linux, `Cmd` on macOS. Exact guards in §3.1.)

### 1.2 Keyboard-accessibility fixes landing in the same task

1. **Row keydown bubbling bug** (live today): the row's `(keydown.enter)` /
   `(keydown.space)` (`entry-list.html:183-184`) fire for keydowns bubbling
   from nested controls — only *clicks* are stopped (`:199,231,241`) — so
   Space on the row checkbox both toggles it **and opens the editor**.
2. **Roving tabindex** on entry rows: one Tab stop in the list (on the active
   row), `aria-current` on the active row, and a custom `:focus-visible` ring
   (the row currently rides the UA default outline only;
   `entry-list.scss:124-128` is focus-*within* reveal, not a ring).
3. **Keyboard range selection** (`Ctrl+Space`, `Shift+↑/↓`) reusing task 20's
   anchor/range logic (`entry-list.ts:447-525`).
4. **Confirmation dialogs** before history restore (`rollbackTo` silently
   discards uncommitted work, `commit-history.ts:104-106`) and single-entry
   delete (`entry-list.ts:626-636`) — both unrecoverable (no undo system
   exists; task 13 never ran). Batch delete already confirms
   (`entry-list.ts:654-682`) — this reaches parity.
5. **Mechanical focus/ARIA set**: `:focus-visible` coverage for the app's
   custom (non-Material) interactive surfaces, skip-to-content link, labels +
   `aria-expanded` on the two drawer panes/toggles, sr-only `h1` for the
   project shell, `aria-label="Entry name"` on the name input.
6. **Shortcuts help dialog** (`?` chord + a topbar entry): the chord catalog
   rendered from the resolver's own table (§3.6) — ten chords with zero
   in-app discovery is a map nobody learns, and the chords claim browser
   defaults users will run into. Added 2026-10-01 (user decision:
   discoverability cannot be assumed).

## 2. Grounding (develop @ `90bb582`, v1.11.0)

Re-audited 2026-10-01 (anchor refresh + full keyboard/a11y sweep). Drift from
the 2026-09-22 draft: `project-actions.service.ts` moved
`core/services` → **`features/shell/`**; `EntryList.filtered` is **protected**
and `scrollToEntry` **private**; `WorkspaceService.commit()` does no message
validation itself (the form owns it); there is no public read-only predicate
on `WorkspaceService`; `relinquishing` is a read-only lock state the old draft
missed.

### 2.1 Actions the chords wire to (all exist)

| Action | Current anchor |
|---|---|
| Commit | `WorkspaceService.commit(message)` (`workspace.service.ts:519-529`) — returns `false` on no-project or `writeBlocked()` (pulses `blockedAttempt`); saves immediately on success. Message rules live in the form only (`commit-history.ts:53-67`: required, ≤200 trimmed) ⇒ the chord's auto-message must satisfy them |
| New entry | `WorkspaceService.addEntry()` (`workspace.service.ts:301-314`) — appends, routes `mutateProject`, **opens the entry's tab** and sets `activeTabId`; sidebar effect reveals it. Thin wrapper `ProjectActionsService.createEntry()` at `features/shell/project-actions.service.ts:588-590` |
| Quick-filter | `entry-list.html:33-39`, `aria-label="Filter entries"` (line 38) |
| Entry order / active | `EntryList.filtered` computed (`entry-list.ts:311-330`, **protected**); active = `WorkspaceService.activeTabId` (`workspace.service.ts:81`); `openEntry` (`:499-505`) is idempotent and always sets the active tab |
| Reorder | `WorkspaceService.moveEntry(prev, cur)` (`:406-424`) — **working-tree indices**, resyncs `display_index`; `EntryList.drop()` (`entry-list.ts:770-788`) holds the filtered→tree index translation to extract and reuse |
| Enabled toggle | `updateEntry(id, { enabled })` (`workspace.service.ts:275-282`) |
| Dirty check | `hasUnsavedChanges` computed (`workspace.service.ts:44-48`), public |
| Name field | `entry-name.html:1-6` — `matInput` with `mat-label "Name / Comment"`, **no `aria-label`**; inactive mat-tab bodies keep inert DOM copies ⇒ focus must scope to `.mat-mdc-tab-body-active` (rule pinned at `entry-content-field.html:28-31`) |

### 2.2 Shell wiring surface

- `app.ts` hosts the dispatch precedent: `runBarAction` (`:692-720`) /
  `runBatchBarAction` (`:751-810`), exhaustive `never` switches;
  `viewChild(EntryList)` at `:143`, `viewChild(Topbar)` at `:142`.
- Exactly one global listener exists today (document `visibilitychange`,
  passive, `DestroyRef`-torn-down — `app.ts:402-405`): the teardown pattern
  the shortcut service copies.
- The entries-drawer resize handle is the app's one custom keyboard widget
  (`app.html:38-51` → `app.ts:617-638`): `role="separator"` + arrow keys +
  `preventDefault`-only-when-handled — the a11y exemplar to match.
- Snackbar feedback is direct `MatSnackBar` everywhere (e.g. `app.ts:375`,
  `entry-list.ts:621,643,679,695`); e2e helper `expectSnackbar`
  (`e2e/helpers.ts:238`).
- Overlay gate: `ResponsiveOverlayService.anyOverlayOpen` computed
  (`responsive-overlay.service.ts:73`) — chords must be inert while a
  dialog/bottom sheet is open (Material owns keys there; prevents e.g.
  `Mod+S` double-committing from inside the commit dialog).
- Lock states: `SessionLockState` = `'idle' | 'acquiring' | 'held' |
  'blocked' | 'relinquishing' | 'lost'` (`session-lock.service.ts:21-27`);
  writes allowed iff `state() === 'idle' || canEdit()` (mirror of private
  `writeBlocked`, `workspace.service.ts:557-563`). All chord targets are
  mutators that **self-gate** through `mutateProject`/`writeBlocked` and
  pulse `blockedAttempt` → the shell's read-only snackbar (`app.ts:369-379`)
  already renders the feedback. The shortcut layer adds no lock logic of its
  own.

### 2.3 Keyboard/a11y sweep (what exists, what's free, what's missing)

- **Manual key handling today**: 11 template bindings (row Enter/Space,
  drawer-resize arrows, chip-editor Enter/Escape, three Enter-to-submit
  inputs, chip separator keys) and **zero** global/`HostListener` keydown
  handlers. No `isComposing` guard anywhere (IME risk on every existing
  Enter binding). No `aria-keyshortcuts`, no `accesskey`.
- **Free from Material/CDK**: tab-group arrows, menu/arrows/typeahead/Escape,
  dialog+sheet Escape/focus-trap/focus-restore (CDK defaults — no
  `autoFocus`/`restoreFocus` overrides exist), select/checkbox/toggle/button
  native keys, chip ListKeyManager. Drawers close on Escape only when focus
  is inside the pane — the phone focus policy (`app.ts:528-559`) buys that.
- **Mouse/touch-only surfaces**: drag-reorder (CDK drag has no keyboard;
  no move-up/down affordance exists — batch menu holds only Duplicate/
  Enable/Disable/Delete), range selection (shift+click / long-press
  interceptor, `entry-list.ts:146-150, 466-498`), chip-edit arming (dblclick;
  keyboard-driven once open).
- **Focus visibility**: no global `:focus-visible` baseline
  (`styles.scss` has zero focus rules); six spot-fixes exist (resize handle
  `app.scss:69-72`, tab close `entry-editor.scss:150-152`, read-only pill
  `topbar.scss:113-115`, delimiters preview `delimiter-dialog.scss:269-271`,
  welcome items `welcome-screen.scss:75-77`, bar items
  `mobile-bottom-bar.scss:190-192`).
- **Landmarks/labels**: no skip link; topbar is not a landmark
  (`topbar.html:1`); both `mat-sidenav` panes lack role/aria-label
  (`app.html:8-16, 73-91`); no `h1` in the project shell; drawer toggles
  lack `aria-expanded` (`topbar.html:2-10, 404-418`); all 39 icon buttons
  carry `aria-label` (verified); live regions used correctly beyond
  snackbar.
- **Read-only veil**: `sessionVeiled` (`blocked`/`lost`/`relinquishing`)
  stamps `[attr.inert]` on the editor (`entry-editor.ts:384-403`) — the
  a11y tree and tab order already exclude veiled content; nothing to add.

## 3. Design

### 3.1 Pure resolver — `core/models/shortcut-map.ts`

Bare, framework-free, total (house shape: `st-trigger.ts`, 189 lines, only
imports `./lorebook.model`). Takes a DOM-ish event view + scope + platform,
returns the action or `null` — the whole guard table is unit-testable
without a browser.

```ts
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

/** 'text' = typing-capable element, 'list' = inside the entry sidebar
 *  (and not text), 'other' = anywhere else. */
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

Guard table (the contract checkpoint 10-1 approves):

| Chord | Action | `text`? | `other`? | `list`? | Notes |
|---|---|---|---|---|---|
| `Mod+S` | `commit-snapshot` | **yes** | yes | yes | saving while drafting is the point; steals browser Save |
| `Mod+N` | `new-entry` | **yes** | yes | yes | steals browser New Window/Tab |
| `Mod+F` | `focus-filter` | **yes** | yes | yes | steals browser Find |
| `Alt+↑`/`Alt+↓` | `nav-prev`/`nav-next` | no | yes | yes | macOS `Option+↑` is a text chord — `text` guard keeps it safe |
| `↑`/`↓` (no modifiers) | `nav-prev`/`nav-next` | no | no | **only here** | natural roving-list arrows |
| `J`/`K` (no modifiers) | `nav-next`/`nav-prev` | no | no | **only here** | bare letters must always type |
| `Alt+Shift+↑`/`Alt+Shift+↓` | `move-up`/`move-down` | no | yes | yes | reorder chords; text-editing chords everywhere when unguarded |
| `Mod+Shift+D` | `toggle-enabled` | no | yes | yes | Chrome bookmark-all-tabs on both platforms — claimed |
| `Ctrl+Space` | `select-toggle` | no | no | **only here** | OS/IME `Ctrl+Space` is safe: list scope excludes text fields |
| `Shift+↑`/`Shift+↓` | `select-extend-prev`/`next` | no | no | **only here** | anchor extension, task 20 parity |
| `?` (`key === '?'`, no Mod/Alt) | `show-help` | no | yes | yes | `?` must always type in text fields; `Mod+/` alias is a checkpoint option (AltGr layouts — risk 9) |

Universal guards: `isComposing` ⇒ `null`; unclaimed chords ⇒ `null` and **no**
`preventDefault`; `Mod` = `metaKey` on `apple`, `ctrlKey` elsewhere (`Ctrl+S`
on macOS stays the browser's); any chord with stray extra modifiers ⇒ `null`.

### 3.2 Shortcut service — `shared/services/keyboard-shortcuts.service.ts`

`@Service()` (Angular 22 built-in decorator), root-provided, owning exactly
one `DOCUMENT` keydown listener (bubble phase; `preventDefault` only on a
non-null resolution; teardown via `DestroyRef` — the `visibilitychange`
precedent at `app.ts:402-405`). Per event it computes, in order:

1. **Overlay gate**: `responsiveOverlay.anyOverlayOpen()` ⇒ bail (null).
2. **Scope** from `event.target`: `text` if typing-capable — `textarea`,
   `[contenteditable]`, or `input` whose type is text-entry (**excluding**
   `checkbox`/`radio`/`button`/`submit`/`file`/`range`/`color`, so a focused
   row checkbox is `list`, not `text`) and not inside a `mat-select` trigger
   (arrows keep native select behavior → classify `other`); `list` if the
   target is inside the `app-entry-list` host; else `other`. The `text`
   predicate wins over `list` (the filter input lives inside the host).
   Implementation verifies the predicate against the rendered Material DOM;
   checkpoint 10-1 pins the resulting classification table.
3. **Platform** once at startup; then `resolveShortcut`.
4. Dispatch through a single registered handler
   (`register(fn: (action: ShortcutAction) => void)`), invoked from `app.ts`.

`app.ts` gains `runShortcutAction(action)` — the `runBarAction` exhaustive
`never`-switch pattern — routing workspace actions directly and view actions
through `viewChild` refs. Early guard: `workspace.activeProject()` null ⇒
silent no-op (welcome screen).

### 3.3 Chord action semantics

- **`commit-snapshot`**: if `!hasUnsavedChanges()` ⇒ snackbar "Nothing to
  commit." and stop (the content-addressed chain would mint a new id for an
  unchanged book — history noise). Else `commit('Snapshot · <local
  yyyy-mm-dd hh:mm>')` (≤200 chars, renders verbatim in history
  `commit-history.html:57`) and snackbar the short hash. Blocked/lost lock ⇒
  `commit` returns `false` + pulses `blockedAttempt` ⇒ existing read-only
  snackbar.
- **`new-entry`**: `workspace.addEntry()` (opens the tab), then focus the
  name input **of the active tab body** — new public
  `EntryEditor.focusNameField()` querying `.mat-mdc-tab-body-active` scope
  (unscoped queries hit the hidden inert copies), deferred one render pass
  (`afterRenderEffect` precedent: `entry-keys.ts:119-125`). The input gains
  `aria-label="Entry name"` (hook + `getByLabel` fixity).
- **`focus-filter`**: `EntryList.focusFilter()` — focus + select
  (`entry-list.html:33-39`). Drawer closed (phones) ⇒ no-op: the chord set
  serves keyboard-carrying viewports.
- **`nav-prev`/`nav-next`**: step `activeTabId` through `filtered()` order
  (clamp at ends, no wrap), `openEntry(target)`, bring the row into view
  (`scrollToEntry`, `entry-list.ts:599-607`, made reusable — virtual-scroll
  settle races handled by its existing deferral). Invoked from `list` scope
  (J/K, arrows, or Alt+arrows while a row has focus), also move DOM focus to
  the reached row; from `other` scope (Alt+arrows in the editor), focus is
  untouched.
- **`move-up`/`move-down`**: reorder the **active** entry by one **visible**
  position — extract `drop()`'s filtered→tree index translation
  (`entry-list.ts:770-788`) into a shared helper; active entry not in
  `filtered()` ⇒ move one position in tree order. Stays active + scrolled
  into view; focus follows only when invoked from `list` scope. New public
  `EntryList.moveActive(delta)`.
- **`toggle-enabled`**: flip `enabled` on `activeTabId`'s entry via
  `updateEntry`; no active entry ⇒ snackbar "Open an entry first."
- **`select-toggle` / `select-extend-*`**: `EntryList` public methods over
  the existing selection model — `Ctrl+Space` toggles the focused row;
  `Shift+↑/↓` extends from the task-20 anchor (same range math as
  shift+click, `entry-list.ts:447-525`). Roving focus moves with the
  extension.

### 3.4 Entry-list keyboard model (roving tabindex, rows stay `role="button"`)

- Row `tabindex`: `0` on the **active** entry's row, `-1` on all others
  (`[attr.tabindex]` binding off `activeTabId`) — one Tab stop in the list,
  wherever the list is scrolled. `aria-current="true"` on the active row.
- **Bubbling fix**: the row's Enter/Space handlers ignore events whose
  `target` is not the row itself (nested checkbox/duplicate/delete keep
  their native keys; Space on the checkbox toggles selection, nothing else).
- Custom `:focus-visible` ring on `.entry-item` (primary 2px offset ring,
  M3 tokens — the resize-handle exemplar's approach), parity with the
  hover/focus-within reveal (`entry-list.scss:124-128`).

### 3.5 A11y mechanics (phase P3)

- **`:focus-visible` coverage**: extend the six-spot pattern to every custom
  interactive surface (entry rows above; audit the remaining custom controls
  — bar items' 12% state-layer is upgraded to a real ring). **No global
  `*:focus-visible` rule** — Material owns its indicators; a global outline
  double-rings MDC controls.
- **Skip link**: first focusable in `app.html`, "Skip to editor", visible on
  focus only, token-styled; moves focus to the `role="main"` sidenav-content
  (`app.html:56`, `tabindex="-1"` programmatic target).
- **Landmarks/labels**: `aria-label` on both `mat-sidenav` panes ("Entries",
  "Commit history"); `role="banner"` on the topbar host (verify against the
  rendered DOM); `aria-expanded` on the entries/history toggle buttons
  (`topbar.html:2-10, 404-418`) bound to drawer state (+ `aria-controls`
  with pane ids); sr-only `h1` bound to the active project name in the
  project shell.
- **Restore confirmation** (`commit-history.ts:104-106`): route `restore()`
  through `ConfirmDialog` (danger), copy *"Restore this state?"* / body
  naming that every uncommitted change made since this commit is discarded.
- **Delete confirmation** (`entry-list.ts:626-636`): `ConfirmDialog`
  (danger) matching the batch-delete copy shape (`:660-673`) — *"Delete
  entry <title>? This cannot be undone."* Dual-container behavior free via
  the house overlay pattern.
- **One-shot audit** (user-approved method): during P3, one manual Chrome
  DevTools accessibility-checker pass over the main views (shell, entry
  editor, dialogs); findings triaged and fixed in-task, evidence recorded in
  the ledger. No new dependency.

### 3.6 Shortcuts help dialog (discoverability)

Ten chords with zero in-app discovery is a map nobody learns — and these
chords claim browser defaults (`Mod+F` replacing browser Find deserves an
in-app explanation). The lazy implementation is also the correct one: the
help surface is the resolver's own table rendered — no second source to
drift.

- **Catalog export**: `shortcut-map.ts` exports
  `SHORTCUTS_HELP: readonly ShortcutHelpEntry[]` (chord display string,
  action, one-line description, group `'global' | 'list'`) beside
  `resolveShortcut` — one source of truth; the dialog can never disagree
  with the guards. A unit spec pins completeness (every `ShortcutAction`
  exactly once).
- **`?` chord**: action `show-help`, `list`/`other` scope only (§3.1 table).
- **Component**: `shared/components/shortcuts-dialog/` — presentational,
  renders the catalog grouped "Everywhere" / "In the entry list", `kbd`-chip
  chords styled with M3 tokens (exemplar: the batch dialog's grouped list).
  Opened only through `ResponsiveOverlayService.openResponsive` (dialog on
  desktop, bottom sheet on phones); no data injection needed.
- **Topbar entry**: a "Keyboard shortcuts" item in the topbar's About/help
  cluster — the discovery path that needs no foreknowledge (it names the `?`
  chord). If it introduces a new icon ligature, stage the
  `npm run icons:refresh` output with the phase commit.
- **Optional annotation** (checkpoint call): `aria-keyshortcuts` on mirrored
  controls (e.g. the filter input carries `Mod+F`).
- Lands in P2 with the shortcut layer it documents; rides checkpoint 10-1
  evidence and the P3 AFTER screenshots.

### 3.7 Visual gate

P3 closes the task's visible-UI delta set (focus rings, skip link, confirm
dialogs, the help dialog) ⇒ full before/after screenshot protocol under
`__screenshots__/10/{before,after}/` (pinned conditions per AGENTS.md;
keyboard-focused states captured by driving the real app — focus rings need
real `:focus-visible`, the `__screenshots__` mock-script precedents). The
design evidence (ring token choice, skip-link treatment, confirm copy,
help-dialog layout) rides checkpoint 10-1.

### 3.8 Test matrix

| Tier | Required cases |
|------|----------------|
| Unit — `shortcut-map.spec.ts` | full guard table × scope × platform: every row of §3.1 incl. `J` in `text` ⇒ null, `Ctrl+Space` in `text`/`other` ⇒ null, `Alt+↑` in `text` ⇒ null, plain arrows outside `list` ⇒ null, `Ctrl+S` on `apple` ⇒ null, `Cmd+S` on `apple` ⇒ commit, `Alt+Shift+↓` ⇒ move-down, `?` in `text` ⇒ null / `list`+`other` ⇒ show-help, stray-modifier chords ⇒ null, IME composing ⇒ null, unknown chords ⇒ null |
| Unit — help catalog | `SHORTCUTS_HELP` completeness: every `ShortcutAction` appears exactly once, grouped `global`/`list` consistently with the §3.1 scope column |
| Unit — `keyboard-shortcuts.service.spec.ts` | scope classification from real dispatched `KeyboardEvent`s (row div ⇒ list; filter input ⇒ text; row checkbox ⇒ list, not text; editor chrome ⇒ other); `preventDefault` only when handled; overlay gate (open dialog ⇒ inert); listener teardown |
| Unit — entry-list | roving tabindex render (active row `0`, others `-1`, `aria-current`); bubbling guard (Space on checkbox does not open); `Ctrl+Space` toggle + `Shift+↑/↓` extension parity with shift+click ranges (reuse the `shiftClick` helper style, `entry-list.spec.ts:777-845`); `moveActive` filtered→tree mapping (incl. active-entry-hidden fallback) |
| Unit — action semantics | auto-message shape + no-commit-on-clean; toggle without active entry; new-entry focus deferral |
| Unit — confirmations | restore gated on dialog accept/cancel; single delete ditto |
| E2E — `e2e/keyboard-shortcuts.spec.ts` | `Mod+S` creates a history row with the auto-message; `Mod+N` appends an entry and the **active tab body's** name input holds focus (`activeElement` check); `Mod+F` focuses the filter; `Alt+↓`/`J` moves the active row; `Alt+Shift+↓` reorders (row order changes and persists); typing `jk` into the filter inserts letters (no-hijack pin); `Mod+Shift+D` flips enabled; chords inert inside an open dialog |
| E2E — `e2e/keyboard-navigation.spec.ts` | first Tab from body hits the skip link; skip jumps to main; Tab into the list stops once (active row); arrows/J/K move roving focus through a list longer than the rendered window (virtual-scroll settle); `Ctrl+Space` + `Shift+↓` select a range then a batch action applies to it; Space on the row checkbox toggles selection **without** opening the editor; Escape in dialogs unchanged |
| E2E — migrated pins | every existing spec that clicks row-delete or history-Restore now handles the confirm dialog (grep both flows in `e2e/`; mobile projects meet the bottom-sheet confirm) |
| E2E — shortcuts help dialog | `?` opens it from the shell; the topbar entry opens it; typing `?` in the filter input inserts the character (no-hijack pin); the rendered catalog contains `Mod+S` and the `?` entry itself; Escape closes (CDK default) |
| Mobile | chords are inert (no hijack, nothing crashes on keydown; the bar still covers the actions); confirm sheets work |

## 4. Implementation Plan

| Phase | Files | Work |
|-------|-------|------|
| **P1 — Resolver** (core-engine) | `core/models/shortcut-map.ts` (+spec), `core/models/README.md` | §3.1 + the `SHORTCUTS_HELP` catalog export (§3.6) |
| **Checkpoint 10-1** (user) | — | chord table + guards + auto-message + snackbar/confirm copy + help-dialog design + focus-ring/skip-link design evidence (§3.1, §3.3, §3.5–3.7) |
| **P2 — Wiring** (ui-specialist) | `shared/services/keyboard-shortcuts.service.ts` (+spec), `shared/components/shortcuts-dialog/`, `app.ts/.html`, `entry-list.ts/.html/.scss`, `entry-editor.ts`, `entry-name/entry-name.html`, `topbar.*` (help entry) | §3.2–3.4 + §3.6 (service, dispatch, roving list, bubbling fix, nav + move chords, name-field focus, help dialog + topbar entry) — BEFORE screenshots captured at phase start |
| **P3 — A11y mechanics** (ui-specialist) | `styles.scss`, `app.html/.scss`, `topbar.*`, `entry-list.*`, `commit-history.*`, confirm wiring | §3.5 + one-shot DevTools audit + AFTER screenshots (incl. the help dialog) + side-by-side report |
| **P4 — Review** (ts-reviewer) | all touched | exhaustive action unions, listener teardown, signal purity in `navigate`/`moveActive`, scope-predicate typing |
| **P5 — E2E** (qa-auditor) | `e2e/keyboard-shortcuts.spec.ts`, `e2e/keyboard-navigation.spec.ts`, migrated pins | §3.7 |

Commits: `feat(shortcuts): pure chord→action resolver`,
`feat(shortcuts): global shortcut service and keyboard entry navigation`,
`feat(a11y): keyboard selection, focus baseline, and destructive-action
confirmations`, `test(e2e): …`, `docs(next_tasks): …` per phase.

## 5. Orchestration

1. **`core-engine`** — P1 (skills: `typescript-advanced-types`). *Gate:
   `npm run build` + full `npm test` + `npm run lint` + `npm run
   typecheck:e2e`.*
2. **User checkpoint 10-1** — the §3.1 guard table, §3.3 copy, §3.5
   confirm-dialog copy, §3.6 help-dialog design, and the §3.7
   focus-ring/skip-link evidence. Gate stays open until answered (house
   rule); an unanswered gate stops the pipeline, never defaults.
3. **`ui-specialist`** — P2, §3.2–3.4 + §3.6 (skills: `material-3`,
   `angular-developer`). *Gate: fast gate + `desktop-chrome` smoke of
   touched specs.*
4. **`ui-specialist`** — P3 (skills: `material-3`, `frontend-design`).
   *Gate: fast gate + screenshots + audit findings posted.*
5. **`ts-reviewer`** — P4. *Gate: `npm run lint`.*
6. **`qa-auditor`** — P5 (skills: `playwright-cli`). *Gate: fast gate;
   `npx playwright test keyboard-shortcuts keyboard-navigation` green on
   `desktop-chrome` + one mobile project.*
7. **Branch-final sweep** — three-project Playwright run per project +
   `npm test --coverage` + `npm run lint`; push `feature/10-keyboard-…`,
   stop. Never merge — the user merges after manual testing.

## 6. Verification Gates

Per task: `npm run build` · `CI=true npm test -- --watch=false --coverage` ·
`npm run lint` · `npm run typecheck:e2e` · desktop-chrome smoke of touched
specs. Branch-final: full three-project `npx playwright test --project=<name>`
sweep + closing coverage + lint.

## 7. Risks & Open Questions

1. **Browser chord collisions** (`Mod+N`, `Mod+F`, `Mod+Shift+D` claimed
   with `preventDefault` — incl. Chrome's bookmark-all-tabs): inherent to
   the roadmap's map; checkpoint 10-1 states it plainly.
2. **`Ctrl+Space` / `Shift+arrows` OS collisions**: `Ctrl+Space` is the
   Windows/macOS IME toggle — safe because the chord fires only in `list`
   scope, which excludes text fields. Desktop-WM `Alt+Shift+arrows`
   bindings vary on Linux; in-browser delivery is unaffected.
3. **Virtual scroll × roving focus**: navigating past the rendered window
   must scroll before focusing — `scrollToEntry`'s deferral pattern handles
   it; the long-list e2e case pins the race.
4. **Confirm-dialog friction**: delete and restore gain one click for
   everyone (user-approved 2026-10-01); copy rides checkpoint 10-1.
5. **e2e selector migration**: specs pinning instant delete/restore must
   migrate in P5, not after (grep `e2e/` for both flows).
6. **`Mod+S` spam**: rapid presses mint many tiny snapshots — acceptable
   (history is cheap, rollback O(1)); clean-tree suppression is §3.3.
7. **Undo chords stay unclaimed** (`Mod+Z`/`Mod+Shift+Z` untouched): task 13
   never ran and none is scheduled — the map stays clean if it ever does.
8. **Scope predicate vs Material DOM**: the `text`/`list` classification of
   Material's checkbox inputs and select triggers is verified against the
   rendered DOM in P2 and pinned by unit specs; drift across Material
   upgrades is what those specs exist to catch.
9. **`?` across keyboard layouts**: on layouts where `?` needs an
   `AltGr`-class chord the no-Alt guard rejects it; the `Mod+/` alias
   (checkpoint-10-1 option) is the layout-independent fallback.
