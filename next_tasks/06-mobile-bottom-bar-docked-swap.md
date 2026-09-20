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
> **Status**: 🟢 Planned — no implementation started (grounded against `develop` @ `2468de3`)

---

## 1. Objective

Make the phone bottom bar a **stable, always-present app surface**: it never unstamps
when a drawer or dialog opens (no reflow stutter), and while the entries drawer is
open with a row selection it swaps its five quick actions for the batch-edit toolbar
(raised above the drawer's scrim, per the user's proposal). On phones the in-drawer
header batch toolbar disappears — its actions live in the bar — which removes both
the row-skip (defect 2) and the ✕ overflow (defect 3). Tablet/desktop keep today's
inline header toolbar unchanged.

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
- **The batch toolbar lives inside the drawer's header** (`entry-list.html:55-103`):
  inserted `@if (selectionCount() > 0)` between the filter field and the virtual
  viewport — its insertion/removal shifts the list (defect 2). At phone widths the
  row is `[select-all] [count] [tune] [call_split] [more_vert] [close]` ≈ 330px inside
  a ~332px drawer — the ✕ clips (defect 3).
- **Focus hack keyed on the unstamping trigger** (`app.ts:199-203`,
  `onHistoryDrawerOpened`): because the bar's History item unstamps itself mid-click,
  focus falls to `<body>` and the drawer's Escape handling dies; the shell re-focuses
  the pane from `(opened)`. `app.spec.ts:260-311` pins this whole workaround.
- **Material stacking facts** (shipped styles, `node_modules/@angular/material/
  fesm2022/sidenav.mjs:813`): `.mat-drawer-container` is `position: relative;
  z-index: 1` — a stacking context. The bar is a non-positioned sibling **after** it
  in `app.html`'s flex column. That means: with the bar simply left mounted, the
  drawer + its backdrop (z-index 3 inside the container's context) paint **above**
  the bar automatically. "Visible but in background" is the default paint order once
  we stop unstamping — no z-index work needed for the background state.
  CDK overlays (dialogs, sheets, menus) live at the ≥1000 plane and always paint
  above the bar.

## 3. Design

### 3.1 Always-docked bar (defect 1)

- `visible` collapses to `layout.isMobile() && workspace.activeProject() !== null`.
  The `overlayOpen` and `drawerOpen` inputs are **removed** (the background state
  makes them meaningless — dialogs, sheets and drawers all paint above the bar).
- No template/styling work for the background state: the bar is a non-positioned
  sibling painted under the drawer container's `z-index: 1` context (§2). Verified
  empirically in P1 (screenshots, §3.6) — if any ancestor of the bar acquires a
  stacking context that inverts the order, fall back to an explicit
  `z-index: 0; position: relative` on the bar host.
- The bar row keeps its 64px height at all times on phones → the workspace layout
  is identical with drawers open/closed → no stutter by construction.
- `App.onHistoryDrawerOpened` (`app.ts:183-203`): its trigger-vanished premise
  disappears with the always-docked bar. **Decision: replace it with the explicit
  phone focus policy of §3.4** (which subsumes it) and delete the body-guard
  variant; the desktop persistent-trigger pin (`app.spec.ts:313-333`) is untouched.

### 3.2 Batch-action swap (defects 2 + 3)

State matrix (phone, project open):

| Condition | Bar paint plane | Bar content |
|---|---|---|
| No drawer open (idle) | normal (in flow) | five quick actions |
| Either drawer open, nothing selected | under drawer + scrim (background, **mounted**) | five quick actions |
| Entries drawer open **and** `selectionCount() > 0` **and** history drawer closed, no overlay | **raised** above the drawer + scrim | batch toolbar (swapped) |
| Any dialog / bottom sheet / menu open | under CDK overlay (≥1000) — automatically | unchanged |

- **Raised state**: a host class (e.g. `.bar-raised`) sets
  `position: relative; z-index: 2` — above the `.workspace` container's `z-index: 1`
  subtree (drawer + backdrop) but far below the CDK overlay plane, so dialogs and
  menus still cover it. No fixed positioning — the bar remains a normal flex child
  (the charter that retired the FAB stays intact).
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
  - new input `batchActive` (entries drawer open + selection + no history drawer);
  - new output `batchAction` with union
    `type BatchBarAction = 'batch-edit' | 'export-selected' | 'more-batch-actions'`
    (the menu trigger renders in place, like Export) `| 'duplicate-selection' |
    'enable-selection' | 'disable-selection' | 'delete-selection' |
    'select-all-shown' | 'clear-selection'`;
    the existing `(action)` output + `MobileBarAction` union stay untouched so the
    five-item channel and its pins survive as-is;
  - the template branches `@if (batchActive()) { …transplanted toolbar + batch
    menu… } @else { …five items + export menu… }`.
- **Shell routing** (`App`): new `runBatchBarAction` switch → `EntryList` public
  methods (§3.3). After `clear-selection` **and** `delete-selection` (both can
  collapse `selectionCount()` to 0 mid-tap, un-swapping the toolbar under the
  user's finger — the same trigger-vanished bug class §3.4 fixes), the shell
  re-focuses the entries pane when `document.activeElement` fell to `<body>`
  (mirror of the old history guard; entries pane only, phone only).

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
- `App` template binding:
  `[batchActive]="leftOpened() && !rightOpened() && (entryList()?.selectionCount() ?? 0) > 0"`.

### 3.4 Phone drawer focus policy (required correctness companion)

With the bar (and its History trigger) persisting, opening a drawer no longer drops
focus to `<body>` — focus stays on the trigger, which sits **outside** the drawer
pane, so the pane's Escape handling dies for bar-opened drawers (today the
`onHistoryDrawerOpened` hook papers over exactly this via the body-fall accident).
New shell policy, replacing the hook: **when an over-mode drawer finishes opening on
a phone, the shell focuses the pane element** (Material already stamps
`tabindex="-1"` on it), for both panes. Desktop `side`-mode drawers keep the
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
  *"stays stamped while a drawer/overlay covers it, content unchanged"*; removed
  inputs drop from `createBar`.
- `app.spec.ts`: history-focus test (260-311) comments/mechanism per §3.4; add the
  entries-pane case and the clear-selection focus recovery; `mounts the mobile
  bottom bar only on phones…` (350-371) survives unchanged.
- `e2e/mobile-bottom-bar.spec.ts`: *"History action opens the drawer and the bar
  hides while it is open"* (128-154) → bar stays mounted; background state asserted
  honestly via hit-testing (`document.elementFromPoint` at the bar's center must
  resolve inside the drawer/backdrop, not the bar); Escape closes the drawer
  **without** the manual `history.focus()` workaround (focus policy). *"Any dialog
  hides the bar"* (156-171) → same treatment. *"shows five labeled quick actions"*
  (42-65) and the tablet-absence describe (178-200) survive unchanged.
- `e2e/ui-responsiveness.spec.ts:541` — `.batch-bar button` touch targets: the
  transplanted toolbar keeps the class, so the selector survives; verify it
  resolves to the swapped bar's buttons on the mobile project after
  `selectFirstTwoRows`.
- `e2e/helpers.ts:93-105` — `selectFirstTwoRows`'s toolbar assertion keeps passing
  (role/label/`2 selected` preserved); update its "the batch toolbar lives inside
  the drawer" comment.
- **New e2e**: idle → open entries drawer (bar behind scrim) → select two rows
  (bar raises + swaps) → run Batch edit from the swap → sheet opens above →
  close + apply → selection cleared, bar un-swaps; ✕ clears selection and focus
  lands back in the drawer pane; bar returns to background on drawer close.

**Visual gate**: design checkpoint posts a rendered mock of the swapped toolbar +
raised state (and the transplant-vs-bar-items choice) for sign-off **before** P2
lands; the phase report posts before/after screenshots under
`__screenshots__/06-mobile-bar-swap/{before,after}/` — phone 390×844 (mobile-safari
device), fixed theme, seeded project, settled rendering, states: idle bar / drawer
open unselected / two selected (raised swap) / drawer closed with selection.

## 4. Implementation Plan

| Phase | Files | Work |
|-------|-------|------|
| **P1 — Always-docked bar + focus policy** (ui-specialist) | `mobile-bottom-bar.ts/.html/.scss` (+spec), `app.ts`, `app.html`, `app.spec.ts` | §3.1, §3.4: drop the two inputs, collapse `visible`, delete the body-guard hook, add the phone pane-focus policy; background-state screenshot proof |
| **P2 — Batch swap** (ui-specialist) | `mobile-bottom-bar.*`, `entry-list.ts/.html` (+specs), `app.ts/.html` | §3.2, §3.3: `batchActive` input + `batchAction` output + transplanted toolbar + menu leaves; `EntryList` public API; header toolbar `!isMobile()`; shell routing + clear-selection focus recovery; design-checkpoint gate closed first |
| **P3 — Review** (ts-reviewer) | all touched | typing of the two unions, signal purity, no RxJS creep, lint |
| **P4 — E2E & evidence** (qa-auditor) | `e2e/mobile-bottom-bar.spec.ts`, `e2e/ui-responsiveness.spec.ts`, `e2e/helpers.ts`, `e2e/batch-and-tokens.spec.ts` (re-run) | §3.6 migrations + new flow; screenshots + side-by-side in the phase report |

Commits per phase: `fix(shell): keep the mobile bar docked under drawers and dialogs`,
`feat(shell): swap the mobile bar to batch actions during selection`,
`test(e2e): …`, then the `docs(next_tasks)` status commit.

## 5. Orchestration

1. **`ui-specialist`** — P1 (skills: `angular-developer`, `material-3`, `frontend-design`).
   *Gate: `npm test` + `npm run build`; screenshots of the background state.*
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

1. **Paint-order assumption (§3.1)** — if `app-root`'s classes (`.mobile`) or any
   future ancestor creates a stacking context, the bar could paint above the scrim.
   P1 verifies empirically; fallback is an explicit `z-index: 0` on the host.
2. **Raised bar covers the drawer's last row(s)** (~64px). The drawer scrolls;
   acceptable per the user's chosen pattern. Watch the P4 screenshots; if the last
   row is obscured mid-selection, consider a bottom padding inside the drawer while
   raised (follow-up, not a blocker).
3. **Swap flicker on selection↔0 transitions** (batch apply, clear, delete) — the
   content swaps instantly; the clear-selection focus recovery (§3.2) covers the
   keyboard path. Observe in screenshots.
4. **`entryList()` viewChild timing** — the `[batchActive]` binding reads the child
   signal before first render resolves (`?? 0`); strictly better UX would hoist
   selection into a service, which crosses the workspace-mutator charter — not done.
5. **Escape-from-hamburger today** — the entries drawer likely never had working
   Escape when opened from the hamburger (focus stays on the hamburger). §3.4 fixes
   both panes at once; call it out in the phase report as a side fix.
