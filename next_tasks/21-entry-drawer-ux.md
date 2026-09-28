# Task 21 — Entry drawer UX: truncate rows, full-width mobile drawer, resizable drawer

**Status**: 🟢 Implemented on `feature/21-entry-drawer-ux` — branch-final
sweep green 2026-09-28, pushed and awaiting user testing (ledger:
[21-PROGRESS.md](./21-PROGRESS.md)).
**Source**: direct user request 2026-09-28 ("The entry list sidebar looks horrible honestly,
because I have to scroll to the right to see the actions if the entry titles are long") —
preempts the pending queue (task 20 intake precedent). Design settled in a plan-mode
critique (frontend-design / impeccable / material-3 skills); the two open design questions
were answered by the user 2026-09-28 and are locked as D2/D3 below.
**Grounded at**: `develop` @ `c4e6f43` (2026-09-28). Every file/line reference below was
verified in the planning session; re-verify at branch-off per the re-grounding convention.

## Objective

Long entry titles currently push the row actions off-canvas and the list scrolls
horizontally. Fix the drawer's information architecture so the actions are always visible:

1. **Rows truncate** — title ellipsizes, key chips clip, actions stay pinned right;
   the horizontal scroll is removed entirely.
2. **Mobile**: the entries drawer becomes a full-width overlay with an in-pane close
   button (it is a work surface — select, batch, reorder — not a peek).
3. **Desktop/tablet**: the docked entries drawer becomes user-resizable within a clamp,
   persisted across sessions.

The drawer stays a **docked persistent navigator** on desktop/tablet and an **overlay**
on mobile in every variant — width problems are solved by truncation, by focus
(full-width mobile), and by user control (resize), never by floating the drawer over the
editor (see D4).

## Grounding audit

- The horizontal scroll is deliberate and disabling: `src/styles.scss:566-576` sets the
  CDK content wrapper to `width: max-content; min-width: 100%` (global rule — CDK
  internals are unreachable from scoped styles) and `entry-list.scss:91-98` gives
  `.list-viewport` `overflow-x: auto`. Because rows lay out at intrinsic untruncated
  width, the row's own truncation CSS can never engage: `.item-main { flex: 1;
  min-width: 0 }` (`entry-list.scss:167-170`), `.item-title` ellipsis (`:172-176`),
  `.item-keys { overflow: hidden }` (`:185-190`), `.item-actions { flex: none }`
  (`:219-225`). Note the live contradiction: the `.item-actions` comment (`:223-224`)
  claims "no horizontal scrolling is ever needed" while the wrapper rule scrolls.
- The correct fix has an in-repo precedent ten lines below: `app-export-selected-dialog`
  pins its identical CDK wrapper to `width: 100%` for exactly this reason
  (`src/styles.scss:578-583`).
- Shell layout: entries drawer `320px` docked `side`-mode on tablet/desktop,
  `over`-mode `min(88vw, 340px)` on mobile (`src/app/app.html:7`, `src/app/app.scss:17-21`,
  `:50-54` — the comment there, "sidenav overlays get full-width panels", is stale and
  gets rewritten by D2). History drawer `340px`, `side` on desktop only. `leftOpened`
  defaults `true`; a viewport effect re-applies per-band open states
  (`src/app/app.ts:83-84`, `:122-136`) — the drawer is a persistent navigator by design.
  Focus mode centers a `max-width: 780px` editor column between the docked panels
  (`app.scss:39-44`) — this is the asymmetry that motivated the (declined, D4)
  desktop-overlay idea.
- Space budget at 320px: fixed chrome ≈ checkbox ~20px + drag handle 24px + token count
  ~30px + two 44px ghost buttons + gaps ≈ 180px → the title gets ~100–120px once D1
  lands. Ghosts reveal on row hover/`focus-within` and stay visible on `hover: none`
  (`entry-list.scss:115-127`, `:256-262`); 48px touch targets under 768px (`:264-275`).
- Pins that constrain the work: `e2e/ui-responsiveness.spec.ts:585-651` pins the
  horizontal-scroll contract verbatim (migrated in P1 commit 1 — the new contract was
  user-approved with this plan); `:402-423` pins touch actions-visible-without-hover
  (unaffected — improves); `:79-95` releases the mobile entries drawer via Escape
  (width-independent; the sideways-pan bug noted there is pre-existing shell behavior,
  out of scope); `:268-291` / `:293-312` pin band drawer modes (unchanged by D2/D3);
  `e2e/mobile-bottom-bar.spec.ts:206-211` releases the **history** drawer via a backdrop
  sliver tap at `(12, 400)` — stays valid precisely because D2 widens the entries drawer
  only. Unit pins in `entry-list.spec.ts:352-402` (batch bar) are width-agnostic.
- Close-button home: the `.list-header .title-row` block (`entry-list.html:2-14`),
  "New entry" button last. The `close` ligature is already in the icon font subset
  (`entry-list.html:31` filter-clear uses it) — no `icons:refresh` expected.
- App-level unit specs live in `src/app/app.spec.ts` (D3's resize specs land there).

## Locked design (user decisions 2026-09-28 — do not relitigate)

**D1 — Rows truncate; horizontal scroll is removed.** Replace the
`app-entry-list .list-viewport .cdk-virtual-scroll-content-wrapper` rule with
`width: 100%` (export-dialog pattern); `.list-viewport` drops `overflow-x: auto` for
`overflow-x: hidden` as the rendering guard; the stale comments (both the wrapper rule
and the `.item-actions` claim) are rewritten to state the truncation contract. E2e
migration lands in the same commit (P1.1) with the approved new pins: no overflow in
viewport or page, Duplicate's rect fully inside the viewport at `scrollLeft = 0`, and
`.item-title` has `scrollWidth > clientWidth` (ellipsis engaged, not clipped).

**D2 — Mobile: entries drawer full-width ONLY, plus a close button.**
`:host(.mobile) .entries-sidenav { width: 100% }`; the history drawer keeps
`min(88vw, 340px)` — it is a peek surface, its scrim-tap return stays, and its
backdrop-tap e2e release stays valid. Close affordance (the scrim disappears at full
width): a `matIconButton` with the `close` ligature appended to the header title-row
after "New entry", rendered via `@if (layout.isMobile())` — removed from the DOM on
desktop per the responsive-shape contract — `aria-label="Close entries panel"`,
emitting a new `closeDrawer` output wired in `app.html` to `closeLeft()`. Escape and
the topbar toggle keep working unchanged (phone pane-focus policy already covers them).

**D3 — Desktop/tablet: resizable docked drawer. The user decides; the app clamps.**
Range **320–480px** (320 is the batch-bar capacity floor the drawer is designed around),
default 320, no per-band scaling. The App component owns an `entriesWidth` signal; an
inline `[style.width.px]` binding on `.entries-sidenav` applies whenever
`viewport() !== 'mobile'` (mobile width comes from CSS); CSS `min-width`/`max-width`
repeat the clamp as belt-and-braces. Handle: a 6px strip absolutely positioned on the
drawer's inner (right) edge inside the sidenav beside `<app-entry-list />`, rendered
only when not mobile. Accessibility contract: `role="separator"`,
`aria-orientation="vertical"`, `aria-valuemin/max/now`, `tabindex="0"`,
`aria-label="Resize entries panel"`; `cursor: col-resize`, `touch-action: none`.
Interaction: pointer drag via `setPointerCapture` (pointerdown → move updates the
signal → pointerup commits); keyboard `ArrowLeft`/`ArrowRight` ±8px and `Home`/`End` to
min/max, committing on keyup; `user-select: none` and a body-level col-resize cursor
while dragging; double-click resets to 320. Persistence: `localStorage` key
`lorestitch.entries-drawer-width`, read + clamped at startup, written on commit,
try/catch-guarded. This is a shell UI preference — it never routes through
`WorkspaceService` or project state.

**D4 — Scope fence (rejected alternatives recorded with reasons).** History drawer
untouched. Desktop keeps `side`-mode docking at every width — **no overlay-on-content
panel**: M3 recognizes standard (docked, co-planar) and modal (scrim + dismissal
contract) side sheets; a persistent non-modal float is neither, occludes the primary
surface with no boundary semantics, and was explicitly declined by the user after
critique 2026-09-28. No two-line titles (breaks `itemSize="56"` virtual scroll), no
per-row ⋮ menu (two actions don't justify hiding), no hover-collapsed actions (layout
shift on hover). Width changes never substitute for truncation — a 200-character
imported title overflows any clamp; D1 holds at every width D3 can produce.

## Phases & gates

- **P0 — Orchestrator setup**: branch `feature/21-entry-drawer-ux` off `develop`;
  re-ground this plan at HEAD (read-only; report drift before phase 1); capture the
  BEFORE set under `__screenshots__/21-entry-drawer-ux/before/` — seeded project with
  the long-title + 6-key entry (same repro shape as the `ui-responsiveness.spec.ts:585`
  setup), desktop-chrome, viewports 1280×800 / 1024×768 / 390×844, one explicit theme,
  settled rendering. Create `next_tasks/21-PROGRESS.md`. Commit:
  `docs(next_tasks): plan task 21 entry drawer ux`.
- **P1 — ui-specialist** (`.zcode/agents/ui-specialist.md`), three atomic commits, fast
  gate (`npm run build`, `CI=true npm test -- --watch=false --coverage`,
  `npm run lint`) between each:
  1. `fix(entry-list): truncate long titles and key chips instead of scrolling`
     — D1 (styles + comments) **plus the `ui-responsiveness.spec.ts:585-651` migration
     in the same commit** (per D1's approved pins), so the branch never carries a
     stale-red pinned spec; the commit's gate adds a desktop-chrome smoke of that spec.
  2. `feat(entry-list): full-width mobile entries drawer with close button`
     — D2 (app.scss rule + comment rewrite, header X + `closeDrawer` output, app.html
     wiring) + unit specs (output emits on click; button absent at the desktop band via
     the match-media stub).
  3. `feat(shell): resizable docked entries drawer`
     — D3 (signal + handle + persistence) + unit specs in `src/app/app.spec.ts`
     (clamp logic, keyboard steps, storage round-trip with a stubbed localStorage,
     handle absent on mobile band).
- **P2 — ts-reviewer** (before qa-auditor, per pipeline order): strict-typing and lint
  review of the whole P1 diff. Watch: `entriesWidth` stays private to App; localStorage
  access guarded; Signals only (no RxJS); pointer-capture lifecycle cleaned up on
  `DestroyRef`; template handlers keep the house `$event` style. Refactors land as
  `refactor(...)` + fast gate re-run.
- **P3 — qa-auditor**: author `e2e/entries-drawer-resize.spec.ts` (desktop-chrome:
  mouse-drag resizes, clamps at 320/480, persists across reload, keyboard resizes,
  rows still render after resize — CDK viewport recovery under live width change is
  the known risk point, fix-forward if the rendered range needs a nudge); mobile-band
  assertions for full-width + close button (project-gated per the touch precedents).
  Per-task gate: build, unit+coverage, lint, `npm run typecheck:e2e`, desktop-chrome
  smoke of touched specs (`ui-responsiveness`, `entries-drawer-resize`). Commit:
  `test(e2e): pin drawer truncation, mobile full-width and resize contracts`.
- **Branch-final sweep (orchestrator)**: AFTER captures under
  `__screenshots__/21-entry-drawer-ux/after/` — identical pinned conditions, plus the
  drawer at min/mid/max widths — and post the before/after side-by-side to the user
  with the phase report. Then the full three-project Playwright matrix run per project
  (`npx playwright test --project=<name>`, one project per command, all under ~8 min
  each), plus closing `npm test --coverage` and `npm run lint`. Red spec → fix-forward
  to the authoring phase, re-run only the failing project/spec, repeat the whole sweep.
  Push the branch, STOP for user testing — never self-merge to `develop`.

## Stop conditions

- Any deviation from the locked design (D1–D4) — including "just widening instead of
  truncating" — is a human sign-off gate: post the old-vs-new contract with a minimal
  repro and wait. (The D1 e2e contract migration itself was user-approved with this
  plan, 2026-09-28; it is not an open gate.)
- Two consecutive failed fix attempts on a gate → stop, escalate with the failing
  output.
- `git status --short` before every phase commit; unrelated local edits stay out of
  atomic commits. Conventional Commits throughout
  (`.zcode/agents/rules/conventional-commits.md`).
- If any new icon ligature appears (none expected — `close` is already subsetted):
  `npm run icons:refresh` and stage the regenerated font with the feature commit.
