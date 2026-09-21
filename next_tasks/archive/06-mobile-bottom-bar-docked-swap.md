# Task 06 — Mobile Bottom Bar: Always-Docked Bar & Multi-Select Action Swap

> **Source**: User bug report 2026-09-20 — three related phone-UX defects around the
> mobile bottom action bar and the entry-list batch toolbar (screenshots attached to
> the report):
> 1. Opening either sidenav unstamps the bar entirely; closing it re-stamps the bar —
>    the drop-in/pop-back reads as a stutter (user proposal: *keep it visible but in
>    the background*).
> 2. Selecting rows inserts the batch toolbar above the list (`entry-list.html:55-103`),
>    shifting every visible row down; clearing the selection pops them back up.
> 3. On narrow devices the toolbar's trailing ✕ overflows its container (the
>    `390px` screenshot shows it clipped at the drawer's right edge).
>    User proposal: *keep the bottom bar in the foreground and swap its buttons for
>    the multi-entry edit actions only when the entry list is open and multiple
>    entries are selected*.
>
> **Type**: Defect fix + interaction redesign (amends the archived Task 02 §3.3
> amendment's *"hides while overlays or drawers are open"* rule)
> **Suggested agents**: `ui-specialist` (lead) → `ts-reviewer` → `qa-auditor`
> **Status**: ✅ Implemented on `feature/06-mobile-bar-docked-swap`
> (P1–P4 all green — see [06-PROGRESS.md](./06-PROGRESS.md); design 06-1
> answered A2; awaiting user test + ff-merge go-ahead. Known follow-up:
> batch-APPLY focus handoff is outside §3.2's recovery contract)

---

## 1. Objective

Make the phone bottom bar a **stable, always-present app surface**: it never unstamps
when a drawer or dialog opens (no reflow stutter), and while the entries drawer is
open with a row selection it swaps its five quick actions for the batch-edit toolbar
(foreground: fully interactive, spatially below the drawer — the user's proposal).
On phones the in-drawer header batch toolbar disappears — its actions live in the
bar — which removes both the row-skip (defect 2) and the ✕ overflow (defect 3).
Tablet/desktop keep today's inline header toolbar unchanged.

## 2. Current behavior (code audit, `develop` @ `2468de3`)

- **The bar is destroyed, not hidden, while anything covers it.**
  `mobile-bottom-bar.ts:72-78` — `visible = isMobile() && activeProject() !== null &&
  !overlayOpen() && !drawerOpen()`; the template gates everything behind
  `@if (visible())` (`mobile-bottom-bar.html:6`), and `.bar-hidden` is `display: none`
  (`mobile-bottom-bar.scss:34-36`). Opening/closing a drawer therefore tears down and
  rebuilds the flex row: the workspace reclaims the 64px strip, then gives it back —
  the stutter the user filmed. The same happens for every dialog/bottom sheet.
- **The shell feeds both hide flags** (`app.html:67-71`):
  `[overlayOpen]="anyOverlayOpen()"` (`ResponsiveOverlayService.anyOverlayOpen`)
  and `[drawerOpen]="anyDrawerOpen()"` (`app.ts:87`).
- **Drawer/scrim vs. bar geometry** (`app.scss:1-15` + shipped styles,
  `node_modules/@angular/material/fesm2022/sidenav.mjs:813`): `app-root` is a flex
  column (`topbar / .workspace / bar`), `.workspace` (`= .mat-drawer-container`) is
  `flex: 1` **with `overflow: hidden`** — an over-mode drawer and its backdrop are
  absolutely positioned *inside* that container and clipped to its box. The bar strip
  sits **below** the workspace and is never covered by a drawer or its scrim (the
  codebase already says so: the `drawerOpen` input doc, `mobile-bottom-bar.ts:59-66`).
  Consequences: (a) simply leaving the bar mounted removes the stutter, but the bar
  would be fully visible **and interactive** beside an open drawer — exactly the
  "UI that looks reachable but is not meant to be" problem the unmount hack worked
  around; (b) "in background" must be **synthesized** (dim + inert), not inherited
  from paint order; (c) the bar and any drawer are spatially disjoint — no z-index
  conflict can ever exist. CDK overlays (dialogs, sheets, menus) are full-viewport at
  the ≥1000 plane and DO cover/dim the bar automatically.
- **The batch toolbar lives inside the drawer's header** (`entry-list.html:55-103`):
  inserted `@if (selectionCount() > 0)` between the filter field and the virtual
  viewport — its insertion/removal shifts the list (defect 2). At phone widths the
  row is `[select-all] [count] [tune] [call_split] [more_vert] [close]` ≈ 330px inside
  a ~332px drawer — the ✕ clips (defect 3).
- **Focus hack keyed on the unstamping trigger** (`app.ts:199-203`,
  `onHistoryDrawerOpened`): because the bar's History item unstamps itself mid-click,
  focus falls to `<body>` and the drawer's Escape handling dies; the shell re-focuses
  the pane from `(opened)`. `app.spec.ts:260-311` pins this whole workaround.

## 3. Design

### 3.1 Always-docked bar (defect 1)

- `visible` collapses to `layout.isMobile() && workspace.activeProject() !== null` —
  the bar mounts once and never leaves the DOM while a phone session has a project.
  The 64px row (plus safe-area padding) is constant → the workspace above it lays out
  identically with drawers open/closed → no stutter by construction. (Trade: the
  drawer/workspace is ~64px shorter than today's open-drawer state — the price of
  "kept visible"; §7.2.)
- The `overlayOpen` input is **removed**: CDK overlays are full-viewport, cover and
  dim the bar automatically, and block it with their backdrop — no bar-side state
  needed for dialogs/sheets/menus.
- The `drawerOpen` input is superseded by the `backgrounded` bar state (§3.2): while a
  drawer is open and the batch swap is not active, the bar **synthesizes** the scrim
  look it cannot inherit (§2b): a scrim-colored veil over the strip (the backdrop's
  own recipe: `--mat-sidenav-scrim-color`, 40% neutral-variant mix) or an equivalent
  opacity dim, plus `[attr.inert]` on the content (house precedent:
  `regex-test-panel.html:30`) and `pointer-events: none`. Visible — but background.
  The moment the swap activates, veil and inert lift.
- Making content inert while it holds focus releases focus to `<body>` (inert spec) —
  the very tap that opens a drawer hits this, so §3.4's pane-focus-on-open policy is
  a **correctness requirement**, not polish.
- `App.onHistoryDrawerOpened` (`app.ts:183-203`): its trigger-vanished premise
  disappears with the always-docked bar. **Decision: replace it with the explicit
  phone focus policy of §3.4** (which subsumes it) and delete the body-guard
  variant; the desktop persistent-trigger pin (`app.spec.ts:313-333`) is untouched.

### 3.2 Batch-action swap (defects 2 + 3)

One input — `barState: 'normal' | 'backgrounded' | 'batch'` — computed by the shell
(`app.ts` owns all drawer/selection knowledge; a `computed`, bound in `app.html`):

| Condition (phone, project open) | `barState` | Bar appearance / content |
|---|---|---|
| No drawer open (idle) | `normal` | full opacity, interactive — five quick actions |
| Either drawer open, swap not active | `backgrounded` | scrim-veiled + inert — five quick actions (visible, in background) |
| Entries drawer open **and** `selectionCount() > 0` **and** history drawer closed | `batch` | full opacity, interactive — batch toolbar (swapped) |
| Any dialog / bottom sheet / menu open (on top of any row above) | unchanged by the dialog — the CDK overlay covers/dims the strip itself | unchanged |

- **The foreground (`batch`) state needs no stacking games** (§2c: bar and drawer are
  spatially disjoint — the drawer's bottom edge is the bar's top edge). The swap is
  purely content + interactivity; the transplanted toolbar's
  `secondary-container` pill already reads as the active surface. The design
  checkpoint may add a subtle top-edge emphasis if evidence shows it helps — M3
  elevation shadows are pointless at the viewport edge; prefer tonal cues.
- **Swapped content** = today's batch toolbar **transplanted** into the bar host:
  same DOM (`div.batch-bar[role=toolbar][aria-label="Batch actions"]`,
  select-all checkbox, `N selected` count, tune / call_split / more_vert / close),
  same `.batch-bar` class and styles, centered inside the bar strip with its
  `secondary-container` pill look. Keeping the same class/roles is deliberate:
  the shared e2e helper and the touch-target selectors (§3.6) keep working
  unchanged. (Design checkpoint may instead prefer five icon-over-label bar items
  with the count as a label — decide against the rendered mock, §3.6 gate; the
  transplant is the recommended default because it survives every existing pin.)
- The `more_vert` menu gains two leaves so the select-all affordance and the count
  stay reachable in the swap: **Select all shown entries** (mirrors the existing
  checkbox tri-state; disabled when everything shown is already selected) and —
  existing leaves unchanged — Duplicate / Enable / Disable / Delete selected.
- **Component contract** (`MobileBottomBar`):
  - `barState` input **replaces** the `overlayOpen`/`drawerOpen` inputs;
  - new output `batchAction` with union
    `type BatchBarAction = 'batch-edit' | 'export-selected' | 'more-batch-actions'`
    (the menu trigger renders in place, like Export) `| 'duplicate-selection' |
    'enable-selection' | 'disable-selection' | 'delete-selection' |
    'select-all-shown' | 'clear-selection'`;
    the existing `(action)` output + `MobileBarAction` union stay untouched so the
    five-item channel and its pins survive as-is;
  - the template branches `@switch (barState())` — `batch` renders the transplanted
    toolbar + batch menu, `normal`/`backgrounded` render the five items + export
    menu (the host class carries the veil/inert for `backgrounded`).
- **Shell routing** (`App`): `barState` computed as
  `leftOpened() && !rightOpened() && (entryList()?.selectionCount() ?? 0) > 0
  ? 'batch' : anyDrawerOpen() ? 'backgrounded' : 'normal'`; new `runBatchBarAction`
  switch → `EntryList` public methods (§3.3). After `clear-selection` **and**
  `delete-selection` (both can collapse `selectionCount()` to 0 mid-tap, flipping
  `batch` → `backgrounded` and inerting the ✕ under the user's finger — focus drops
  to `<body>`), the shell re-focuses the entries pane (mirror of §3.4; entries pane
  only, phone only).

### 3.3 `EntryList` public API (narrow, typed)

Selection state stays sidebar-owned; the shell only needs thin public wrappers:

- `readonly selectionCount` → public (today `protected`, `entry-list.ts:234`).
- `exportSelection()`, `duplicateSelection()`, `setSelectionEnabled(enabled)`,
  `deleteSelection()`, `clearSelection()` → public (today `protected`,
  `entry-list.ts:281-361, 430-432`).
- `selectAllShown(checked: boolean)` → public wrapper over `toggleSelectAll`
  against the filtered view (`entry-list.ts:248-267`).
- Header toolbar branch becomes `@if (selectionCount() > 0 && !layout.isMobile())`
  (inject `LayoutService` — precedent: `topbar.ts`, `project-actions.service.ts`):
  phones lose the in-drawer toolbar entirely (defects 2 + 3 on phones), while
  tablet/desktop keep the inline toolbar exactly as today.

### 3.4 Phone drawer focus policy (required correctness companion)

The backgrounded bar is inert, and inerting focused content releases focus to
`<body>`; a `batch`-state tap leaves focus on the bar, outside the drawer pane.
Either way the pane's Escape handling (a keydown listener on the pane element)
never sees a key — today's `onHistoryDrawerOpened` hook patches exactly this class
of accident for one pane and one trigger. New shell policy, replacing the hook:
**when an over-mode drawer finishes opening on a phone, the shell focuses the pane
element** (Material already stamps `tabindex="-1"` on it), for both panes — bind
`(opened)` on the entries sidenav too. Desktop `side`-mode drawers keep the
persistent-trigger behavior (`app.spec.ts:313-333` stays green). Side effects:

- Escape-to-close works from every open path (bar item, hamburger, backdrop-then-key);
- screen readers announce the pane (today they never do on phones);
- `app.spec.ts:260-311`'s pane-focus assertion keeps passing, now deterministically —
  its "trigger vanished mid-click" narrative is rewritten in the same commit.

### 3.5 Deliberately unchanged

- Tablet/desktop: no bar exists there; the inline header toolbar and its row-skip
  stay (the user's report and all three screenshots are phone-width). Revisit only
  on a desktop complaint.
- The bar's Export menu, the History badge, `runBarAction` routing: untouched.
- The drawer slide animation and backdrop click-to-close: untouched.

### 3.6 Test matrix & visual evidence

**Migrate (pins of the old behavior):**
- `mobile-bottom-bar.spec.ts` (unit): *"hides while the drawer-open input is set"*
  (99-116) and *"hides while the overlay-open input is set"* (82-97) invert to
  *"stays stamped while a drawer/overlay covers it"* — for drawers the content goes
  `[inert]` + veiled; for dialogs nothing changes (CDK covers); removed inputs drop
  from `createBar`.
- `app.spec.ts`: history-focus test (260-311) comments/mechanism per §3.4; add the
  entries-pane case and the clear-selection focus recovery; `mounts the mobile
  bottom bar only on phones…` (350-371) survives unchanged.
- `e2e/mobile-bottom-bar.spec.ts`: *"History action opens the drawer and the bar
  hides while it is open"* (128-154) → rewritten: the bar stays mounted; the
  backgrounded state is asserted via the synthesized background (content carries
  `[inert]`, host veiled, and tapping a bar item is a no-op while a drawer is open —
  app state unchanged); Escape closes the drawer **without** the manual
  `history.focus()` workaround (focus policy). *"Any dialog hides the bar"*
  (156-171) → the bar persists; assert it remains in the DOM (inert-free) under the
  About sheet and is interactive again after close — the CDK backdrop does the
  covering. *"shows five labeled quick actions"* (42-65) and the tablet-absence
  describe (178-200) survive unchanged.
- `e2e/ui-responsiveness.spec.ts:541` — `.batch-bar button` touch targets: the
  transplanted toolbar keeps the class, so the selector survives; verify it
  resolves to the swapped bar's buttons on the mobile project after
  `selectFirstTwoRows`.
- `e2e/helpers.ts:93-105` — `selectFirstTwoRows`'s toolbar assertion keeps passing
  (role/label/`2 selected` preserved); update its "the batch toolbar lives inside
  the drawer" comment.
- **New e2e**: idle → open entries drawer (bar backgrounded: veiled + inert) →
  select two rows (bar to foreground + swapped) → run Batch edit from the swap →
  sheet opens above → close + apply → selection cleared, bar returns to
  backgrounded; ✕ clears selection and focus lands back in the drawer pane; bar
  returns to normal on drawer close.

**Visual gate**: design checkpoint posts a rendered mock of the swapped toolbar +
foreground state (and the transplant-vs-bar-items choice) for sign-off **before** P2
lands; the phase report posts before/after screenshots under
`__screenshots__/06-mobile-bar-swap/{before,after}/` — phone 390×844 (mobile-safari
device), fixed theme, seeded project, settled rendering, states: idle bar / drawer
open unselected (veiled bar) / two selected (swapped, foreground) / drawer closed
with selection.

## 4. Implementation Plan

| Phase | Files | Work |
|-------|-------|------|
| **P1 — Always-docked bar + focus policy** (ui-specialist) | `mobile-bottom-bar.ts/.html/.scss` (+spec), `app.ts`, `app.html`, `app.spec.ts` | §3.1, §3.4: collapse `visible` to mobile+project, add the `backgrounded` state (veil + inert), delete the body-guard hook, add the phone pane-focus policy (both panes); background-state screenshot proof |
| **P2 — Batch swap** (ui-specialist) | `mobile-bottom-bar.*`, `entry-list.ts/.html` (+specs), `app.ts/.html` | §3.2, §3.3: `barState` `batch` branch + `batchAction` output + transplanted toolbar + menu leaves; `EntryList` public API; header toolbar `!isMobile()`; shell routing + clear-selection focus recovery; design-checkpoint gate closed first |
| **P3 — Review** (ts-reviewer) | all touched | typing of the two unions, signal purity, no RxJS creep, lint |
| **P4 — E2E & evidence** (qa-auditor) | `e2e/mobile-bottom-bar.spec.ts`, `e2e/ui-responsiveness.spec.ts`, `e2e/helpers.ts`, `e2e/batch-and-tokens.spec.ts` (re-run) | §3.6 migrations + new flow; screenshots + side-by-side in the phase report |

Commits per phase: `fix(shell): keep the mobile bar docked under drawers and dialogs`,
`feat(shell): swap the mobile bar to batch actions during selection`,
`test(e2e): …`, plus each phase's `docs(next_tasks)` progress commit (README
conventions).

## 5. Orchestration

1. **`ui-specialist`** — P1 (skills: `angular-developer`, `material-3`, `frontend-design`).
   *Gate: `npm test` + `npm run build`; screenshots of the backgrounded state.*
2. **User design checkpoint** — swapped-toolbar look + transplant-vs-bar-items,
   evidence per the Design Checkpoint Evidence rule. No dispatch of P2 until answered.
3. **`ui-specialist`** — P2. *Gate: `npm test` + `npm run build`.*
4. **`ts-reviewer`** — P3. *Gate: `npm run lint` clean.*
5. **`qa-auditor`** — P4 (skills: `playwright-cli`). *Gate: `npx playwright test` on
   all three projects; mobile-bottom-bar + ui-responsiveness green.*

P1 and P2 touch overlapping files — sequential, not parallel.

## 6. Verification Gates

`npm run build` · `npm test` · `ng test --coverage` (bar, app, entry-list coverage
non-regressing) · `npx playwright test` (all three projects) · `npm run lint` ·
before/after screenshot comparison posted with the P4 report.

## 7. Risks & Open Questions

1. **Veil fidelity** — the synthesized background must visually match app content
   under the real scrim (same token/mix). P1 screenshots compare the veiled bar
   against the dimmed editor strip; adjust opacity/mix if they read differently.
2. **The drawer is ~64px shorter while the bar is docked** (always, on phones) —
   the entries list loses roughly one row of visible height versus today's
   open-drawer state. The inherent price of "kept visible"; flag it to the user in
   the P4 report.
3. **Swap flicker on selection↔0 transitions** (batch apply, clear, delete) — the
   content/state flips instantly; the clear-selection focus recovery (§3.2) covers
   the keyboard path. Observe in screenshots.
4. **`entryList()` viewChild timing** — the `barState` computed reads the child
   signal before first render resolves (`?? 0`); strictly better UX would hoist
   selection into a service, which crosses the workspace-mutator charter — not done.
5. **Escape-from-hamburger today** — the entries drawer likely never had working
   Escape when opened from the hamburger (focus stays on the hamburger). §3.4 fixes
   both panes at once; call it out in the phase report as a side fix.
6. **`batch` under an open dialog** (e.g. the batch sheet opened from the swap):
   `barState` stays `batch` — correct, the CDK backdrop covers/dims the strip and
   blocks pointer events; no special-casing.
