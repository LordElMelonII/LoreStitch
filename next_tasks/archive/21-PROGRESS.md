# Task 21 progress ledger — entry drawer UX

Plan: [21-entry-drawer-ux.md](./21-entry-drawer-ux.md) · Branch:
`feature/21-entry-drawer-ux` (off `develop` @ `c4e6f43`).

## P0 — Orchestrator setup (2026-09-28)

**Re-grounding audit at branch-off** (read-only, no drift requiring a gate):

- All pinned refs verified at HEAD: `styles.scss:566-576` (max-content CDK
  wrapper) and `:578-583` (export-dialog `width: 100%` precedent);
  `entry-list.scss:91-98` (`.list-viewport` `overflow-x: auto`), `:167-176`
  (`.item-main`/`.item-title` truncation CSS), `:185-190`, `:219-225`
  (`.item-actions` + stale "no horizontal scrolling" comment), `:115-127`,
  `:256-275` (ghost reveal + touch floors); `app.html:7`, `app.scss:17-21`,
  `:39-44`, `:50-54` (stale "full-width panels" comment), `app.ts:83-84`,
  `:122-136`; e2e pins `ui-responsiveness.spec.ts:585-651`, `:402-423`,
  `:79-95`, `:268-291`; `mobile-bottom-bar.spec.ts:206-211`;
  `entry-list.spec.ts:352+` (batch bar); `src/app/app.spec.ts` exists.
- One cosmetic drift: the `close` ligature sits at `entry-list.html:34`, not
  the plan's `:31` (3-line shift; the claim — ligature already subsetted —
  holds). Not design-relevant; no gate.

**BEFORE baseline** (`__screenshots__/21-entry-drawer-ux/before/`, gitignored):
capture.mjs per the task-12 pinned-conditions recipe — Playwright chromium,
fresh context per viewport (1280×800 / 1024×768 / 390×844, dsf 1, light theme
via `lorestitch-theme` localStorage init, en-US/UTC), new "E2E Lorebook"
project + the `ui-responsiveness.spec.ts:585` repro entry (long title + 6
keys) through the real editor flow, settled rendering (row title + "+3" chip
observed, fonts.ready + double rAF + settle). One shot per viewport
(`01-entries-drawer`).

Numeric evidence of the before-state bug (probe-before.mjs, same conditions):

| viewport | list overflow | Duplicate beyond viewport @ scrollLeft=0 | title ellipsizes | drawer width |
|---|---|---|---|---|
| desktop 1280×800 | 328px | 264px | no | 320px |
| tablet 1024×768 | 328px | 264px | no | 320px |
| mobile 390×844 | 315px | 247px | no | 340px (min(88vw,340px)) |

**Gates run**: none yet (docs-only phase).

**Commit**: `docs(next_tasks): plan task 21 entry drawer ux` (plan + README
row + this ledger).

**Next**: P1 dispatch 1 — ui-specialist, D1 truncation commit
(`fix(entry-list): truncate long titles and key chips instead of scrolling`)
with the same-commit `ui-responsiveness.spec.ts:585-651` migration.

## P1 — ui-specialist (three atomic commits)

### P1.1 — `fix(entry-list): truncate long titles and key chips instead of scrolling` (2026-09-28)

**Landed**: commit `817e736` — `src/styles.scss` (CDK wrapper `max-content` →
`width: 100%`, export-dialog pattern; comments rewritten to the truncation
contract), `entry-list.scss` (`.list-viewport` `overflow-x: auto` → `hidden`;
`.item-actions` stale comment rewritten), `e2e/ui-responsiveness.spec.ts`
(same-commit migration: test renamed `long entry names and key chips truncate
with actions visible`; new approved pins — no viewport/page overflow,
Duplicate rect inside viewport at `scrollLeft = 0`, `.item-title`
`scrollWidth > clientWidth`; four per-fact `expect.poll` calls so a
regression names the failing fact).

**Gates**: build ✓ (26s) · unit+coverage ✓ (95s) · lint ✓ (25s) ·
desktop-chrome smoke of `ui-responsiveness` ✓ 22/22 (82s, mobile leg
confirms polls absorb the drawer slide-in).

**Deviations**: none — D1 implemented exactly as locked.

**Notes carried forward**: the spec's `document.querySelector('.list-viewport')`
first-match assumption holds unless a second `app-entry-list` instance ever
appears; truncation engages at every D3 width (320–480), so the D1 pins hold
at min/mid/max resize.

### P1.2 — `feat(entry-list): full-width mobile entries drawer with close button` (2026-09-28)

**Landed**: commit `4732209` — `app.scss` mobile block split into two surface
contracts (`entries-sidenav` `width: 100%`; `history-sidenav` keeps
`min(88vw, 340px)`, scrim-tap return intact; stale comment rewritten);
`entry-list.html` close `matIconButton` in `.title-row` after "New entry"
behind `@if (layout.isMobile())` (removed from DOM on tablet/desktop);
`entry-list.ts` new `closeDrawer = output<void>()`; `app.html` wires
`(closeDrawer)="closeLeft()"` inside the `@defer` (idempotent with the
sidenav's own `(closed)` route). Unit specs: presence/absence across mobile ↔
desktop band flips (real-timer 10ms idiom, CDK debounce needs a real
scheduler) + click emits once via `OutputEmitterRef.subscribe`.

**Gates**: build ✓ (26s) · unit+coverage ✓ 1403 passed (92s; coverage drift
checked — all new statements covered) · lint ✓ (22s).

**Deviations**: none — D2 exactly as locked.

**Notes carried forward**: `App.closeLeft()` at `app.ts:161` reused unchanged;
entry-list.html line refs after the button block shifted +3; the D2 comment
block in `app.scss` is where D3's clamp range comment extends.

### P1.3 — `feat(shell): resizable docked entries drawer` (2026-09-28)

**Landed**: commit `e60c94f` — `app.ts` (clamp constants 320/480/320, step 8,
storage key `lorestitch.entries-drawer-width`, pure `clampEntriesWidth` +
guarded `restoreEntriesWidth`, `entriesWidth` signal, pointer drag with
`setPointerCapture` + live clamp, keyboard ±8 / Home / End committing on
keyup, dblclick reset, body `entries-resize-active` chrome removed on end +
`DestroyRef`), `app.html` (`[style.width.px]` unbound at mobile; handle with
the exact locked a11y contract), `app.scss` (`:host(:not(.mobile))` clamp so
D2's 100% is never capped at 481–767px; 6px handle strip, col-resize,
touch-action none, z-index 2), `styles.scss` (global body resize chrome),
`app.spec.ts` (12 new specs: startup clamp table, presence/a11y + mobile-band
removal, keyboard steps + keyup commit, storage round-trip/throwing-storage,
pointer drag + second-pointer guard + pointercancel recovery, dblclick reset,
mid-drag destroy cleanup; Map-backed localStorage stub, jsdom-safe synthetic
pointer events).

**Gates**: build ✓ (~16s) · unit+coverage ✓ 1415 passed (~3-4min; app.ts
92.3% stmts / 89.2% branches / 95.1% funcs — uncovered are pre-existing
exhaustiveness throws + two unreachable defensive arms) · lint ✓.

**Deviations**: none in contract. Two implementation choices inside D3's
unspecified space, flagged: (1) handle shows a quiet 2px primary line on
hover/`focus-visible` — D3 fixes geometry/cursor/touch-action only and an
invisible strip fails the affordance rule; visible in the AFTER captures.
(2) `(keyup)` commits any keyup while a keyboard resize is in flight.

**Notes for P3**: handle selector `[aria-label="Resize entries panel"]`
(unique; use exact:true next to "Close/Toggle entries panel"); live width =
`.entries-sidenav` inline `style.width`; localStorage write lands on keyup
(reload-persistence observable only after release); drag = real mouse
down/move/up, width tracks `clientX − drawer.left` clamped.

## P2 — ts-reviewer (2026-09-28)

**Reviewed**: full P1 diff (`817e736` + `4732209` + `e60c94f`) — every hunk +
whole-file reads of `app.ts`, `app.spec.ts`, `entry-list.ts`/`.spec.ts`.

**Findings**: 1 should-fix, landed as commit `2ea657f` —
`refactor(shell): end an in-flight drawer resize drag on viewport band flips`
— a mid-drag band flip unmounted the handle (implicit capture release), so
`pointerup` never reached the handler: `entries-resize-active` lingered on
`<body>` and the stale drag swallowed later pointerdowns. Fix: constructor
`effect` ends the drag on an actual band change (pointercancel semantics, no
commit); spec pins chrome removal + no storage write + next-gesture recovery.
Judgment calls ruled acceptable unchanged: `(keyup)` without `$event` (house
style passes `$event` only when consumed; key-filtering would change the
locked semantics), the single documented `as unknown as PointerEvent` in
`app.spec.ts` (jsdom shadowed pointerId), `{ pointerId, handle } | null`
state shape, `closeDrawer` wiring idempotence (second `closeLeft()` is a
`set(false)` no-op + re-runnable settle).

**Verified clean**: `entriesWidth` private to App; storage guarded both ways
(garbage → NaN → default per ThemeService precedent); signals only, pure
`computed()` aria mirrors; `$event` style elsewhere; ESLint clean; no `any`/
non-null assertions (narrowing via `assert`).

**Gates (after refactor)**: build ✓ (16s) · unit+coverage ✓ 1416/1416
(src/app 93.35% stmts) · lint ✓.

**Notes for P3**: selectors handle `[aria-label="Resize entries panel"]`
(use `exact:true` — "Close/Toggle entries panel" neighbors), pane
`.entries-sidenav` inline `style.width`, close button
`[aria-label="Close entries panel"]`; drag math reads the pane rect per move
(true geometry for Playwright mouse); keyboard commits on keyup (dispatch
keyup before reading storage); drag commits on pointerup, no debounce;
mid-drag viewport change now ends the gesture uncommitted — don't author a
spec that resizes the window mid-drag and expects persistence;
`entries-resize-active` on `<body>` only during a pointer drag.

## P3 — qa-auditor (2026-09-28)

**Landed**: commit `dcaf963` — `test(e2e): pin drawer truncation, mobile
full-width and resize contracts` — new `e2e/entries-drawer-resize.spec.ts`
(351 lines, 8 tests). Docked band (desktop-chrome; skips on mobile projects):
mouse drag live-tracks (two mid-gesture stops, aria-valuenow/min/max pinned),
clamps at 320/480 (painted width), commit persists across reload, keyboard
arrows/End/Home with the keyup-commit seam split asserted (storage null
before keyup, written after), dblclick reset, rows keep rendering across the
range (Fate fixture, 70 entries, 480→400→320 stops, virtual-list fill
contract). Mobile band (mobile-chrome + mobile-safari; skips on desktop):
full-width vs the live layout viewport, handle `toHaveCount(0)`, header close
button releases the drawer (accessible-name assertions, no tooltip text on
touch).

**Gates**: build ✓ (20s) · unit+coverage ✓ 1416 (65s) · lint ✓ (16s) ·
typecheck:e2e ✓ (5s) · desktop-chrome smoke `ui-responsiveness` +
`entries-drawer-resize` ✓ 28 passed / 2 skipped by design (1m07s). Bonus
beyond the gate: both mobile projects pre-run green (2 passed / 6 skipped
each) so the phone legs are proven before the sweep.

**In-task fix**: one spec bug (storage-asserting `page.evaluate` callbacks
referenced a spec-scope constant — not serialized into the page; fixed by
inlining the key literal). No app bug found; CDK row recovery works on its
own (ResizeObserver → `checkViewportSize()`), no nudge needed.

## Branch-final sweep (2026-09-28)

**AFTER captures** (`__screenshots__/21-entry-drawer-ux/after/`, identical
pinned conditions — same script, contexts, theme, fixture, settle): 9 shots —
`01-entries-drawer` per viewport plus desktop/tablet `02-resize-max-480` /
`03-resize-min-320` / `04-resize-mid-400` driven by keyboard on the real
handle. Capture-hygiene note (task-12 precedent): after-set suppresses
`.mat-mdc-tooltip-panel` capture-side; no pinned condition changes.

**After-state probe** (probe-after.mjs, same conditions as the before probe):

| viewport | list overflow | Duplicate beyond viewport @ scrollLeft=0 | title ellipsizes | drawer width |
|---|---|---|---|---|
| desktop 1280×800 | 0px | inside by 64px | yes | 320px |
| tablet 1024×768 | 0px | inside by 64px | yes | 320px |
| mobile 390×844 | 0px | inside by 68px | yes | 390px (full width) |

**Full three-project Playwright matrix** (one project per command):

- `desktop-chrome`: 83 passed, 20 skipped (3.7m)
- `mobile-chrome`: 50 passed, 53 skipped (2.8m)
- `mobile-safari`: 48 passed, 55 skipped (4.0m)

Skips are by design (phone-pinned tests skip on desktop and vice versa). No
red spec — no fix-forward loop needed.

**Closing gates**: `CI=true npm test -- --watch=false --coverage` ✓ 61 files,
1416/1416, thresholds enforced in-run · `npm run lint` ✓ all files pass.

**Branch pushed** for user testing: `origin/feature/21-entry-drawer-ux`.
Never self-merged — `git merge --ff-only` into `develop` waits for the user's
explicit go. On the go: archive this ledger beside the plan (Task 02
precedent), flip the README row. Release cut is NOT part of this task.

### Commits on the branch

| SHA | Message |
|---|---|
| `1c6b03f` | docs(next_tasks): plan task 21 entry drawer ux |
| `817e736` | fix(entry-list): truncate long titles and key chips instead of scrolling |
| `4732209` | feat(entry-list): full-width mobile entries drawer with close button |
| `e60c94f` | feat(shell): resizable docked entries drawer |
| `2ea657f` | refactor(shell): end an in-flight drawer resize drag on viewport band flips |
| `dcaf963` | test(e2e): pin drawer truncation, mobile full-width and resize contracts |
| (+ per-phase `docs(next_tasks)` ledger commits) | |

## Round 2 — user testing feedback (2026-09-28)

The user tested `ece35d9` and reported three issues; all three fixed by
ui-specialist as atomic commits (fast gate green between each):

1. **Key chips sliced mid-chip** (D1 shipped `overflow: hidden` clipping) —
   `5989f8c` `fix(entry-list): ellipsize key chip labels instead of slicing
   chips`: `.key-chip` gets `flex: 0 1 auto; min-width: 0` + per-chip
   ellipsis; `.constant`/`.vectorized`/`.more` stay `flex: none` (status
   badges and the +N count never compress); tooltips already carry full text.
   This refines D1's "key chips clip" wording per the user's direction —
   recorded as a user-revised refinement, not an orchestrator deviation.
2. **No visible resize affordance** — `93785fa` `fix(shell): give the
   entries resize handle a persistent visible affordance`: the handle's 2px
   line is now persistent quiet `--mat-sys-outline-variant`, upgrading to
   primary on hover/focus-visible. The user pre-approved "thicker right
   border or a handle"; the border reading chosen.
3. **Editor content overlapped by the drawer after a live resize; close/
   reopen fixed it** — root cause verified in Material source: side-mode
   content margins (`_contentMargins` host-bound to
   `style.margin-left`) recompute only via the container's public
   `updateContentMargins()`, which fires on open/close animations, mode
   changes, window resizes — never on an inline width change (autosize off).
   `c045f19` `fix(shell): recompute content margins as the entries drawer
   resizes`: second `#workspaceEl` viewChild read as `MatSidenavContainer` +
   a width-driven constructor effect (viewport read via `untracked`) calls
   the public method; mobile band skipped (over-mode, null binding). Spec:
   spy pins exactly-one call on a width change, none when unchanged, none at
   mobile band. 1417 unit tests.

**Gates per commit**: build ✓ · unit+coverage ✓ (1416 → 1417) · lint ✓.

**Next**: ts-reviewer over `ece35d9..HEAD`, then qa-auditor pins (chips not
sliced + never-compressed badges/counts; content not overlapped after live
resize with the 400ms margin transition settled), then branch-final sweep
round 2 (refreshed AFTER captures + probe) and re-push.

## Round 3 — chip feedback clarified (2026-09-28)

**User rejected the round-2 chip fix** (per-chip ellipsis was not the intent):
"show the full chips, and the ones not fitting the rows would go in the
counter where you can hover for the tooltip". ts-reviewer had passed R2 clean
(verdict: no findings — the rejection is design, not code quality). The
cancelled R2 qa dispatch left no tree state (verified clean).

**Landed**: commit `cf18871` — `fix(entry-list): fit whole key chips and
count the overflow in the +N chip` — new per-row `EntryKeys` component
(`entry-keys.ts/.html/.scss`, host keeps the `.item-keys` class): hidden
`max-content` measurement row (all chips + `+N` probe), ResizeObserver →
`containerWidth` signal, tracked effect measures + calls the pure fit in
`entry-keys.model.ts` (`fitKeyChips` — descending-scan counter reservation,
immune to the 2-cycle a fixed-point loop can hit at exact-fit boundaries),
visible row renders full chips + dynamic `+N` whose tooltip lists hidden
keys. Static `slice(0, 3)` cap removed; round-2 shrink/ellipsis CSS fully
reverted; one-shot `document.fonts.ready` re-measure for the font-swap
re-metric. Specs: 16 model (fit truth tables) + 10 component (hide/count/
tooltip/widen/RO wiring) — 1443/1443 unit.

**Gates**: build ✓ (22.5s) · unit+coverage ✓ (new files 94.8-100% stmts) ·
lint ✓. Two in-task fix-forwards were spec bugs (one real: a shared-jsdom
non-configurable RO stub from entry-editor.spec — descriptor-aware
install/restore added).

**Deviations**: none from the user's round-3 contract. Refinement inside the
recommended architecture: descending-scan fit instead of fixed-point loop
(equivalent + provably non-oscillating).

**Notes for qa**: `.key-chip` selects VISIBLE chips only (measurers are
`.measure-chip`); counter is `.key-chip.more` with text `+N`; fit is monotone
in width (widen never removes a visible chip); at 480 many more than 3 chips
show; no existing e2e pins chip DOM — pins are qa's to author.

**Next**: ts-reviewer over `137d298..HEAD`, then qa-auditor (full-chips/+N
pins AND the still-unlanded content-margin recovery pin from the cancelled
R2 dispatch), then branch-final round 3.

## Round 3b — qa found two more app bugs; both fixed (2026-09-29)

The R3 qa dispatch (killed once by a machine shutdown; its completed e2e
authoring was audited and landed unchanged) gated against live app behavior
and caught:

1. **Margin recompute ran before the width binding applied** — the R2
   `c045f19` effect read the drawer's width one step behind: single-jump
   resizes (End/Home/dblclick) left the editor margin at the previous width
   (full overlap / dead gap); drags masked it by re-firing per move. Fixed
   `ec48990` `fix(shell): recompute content margins after the width binding
   applies` — `afterRenderEffect` (entry-keys precedent) runs after the
   template-binding phase; probe-verified exact on End/Home/drag (3 runs);
   unit spec gained an ordering discriminator (records the pane's inline
   width at each call).
2. **Key strip froze unmeasured across phone drawer close/reopen** — keys
   staged while the drawer was closed (the natural phone flow) then reopen:
   close skipped the 0×0 RO delivery leaving a stale width; keys staged
   against the `display:none` measurement row fit "everything"; the reopen
   delivery was an equal-value no-op, freezing the garbage fit. Fixed
   `2e9ccb6` `fix(entry-list): recover the key-strip fit when the drawer
   reopens` — zero-size RO deliveries store `null` (unmeasured) so both
   transitions are real changes, plus an all-zero-metrics fit guard;
   probe-verified (minimal repro settles at poll 0, twice, no nudge); 4 new
   RO-path unit specs (1446/1446 total).

**QA landed**: commit `3935762` `test(e2e): pin full-chip overflow counting
and content-margin recovery` — `measureKeyStrip`/`addKeysToActiveEntry`
helpers (paced adds against the zoneless flush), chip-contract pins on all
ui-responsiveness legs (whole chips, no ellipsis, counter consistency,
hidden-keys tooltip desktop-only), count-grows-on-widen (320→400→480 real
drags, monotone), margin-follows-drag + margin-follows-keyboard (settled
±2px past the 400ms transition, negative repro). Gates all green: the
previously failing mobile-390 leg 22/22, build/unit 1446/lint/typecheck ✓,
combined smoke 31 passed, both mobile projects green; timing-sensitive polls
green twice consecutively, no retries consumed.

**Pending**: quick ts-review pass over `9238784..2e9ccb6` (both fixes are
P2-watchpoint code), then branch-final round 3 (refreshed AFTER captures +
probe, full matrix, closing gates).

## Branch-final sweep, round 3 (2026-09-29)

**ts-review pass over the two post-review fixes** (`ec48990`, `2e9ccb6`):
clean — no commits. Verified no effect write-read cycles (render-all is a
write to a signal the fit effect does not read; measurement row renders
unconditionally), `null` is the single unmeasured sentinel (0 never stored),
the all-zero guard is exact (padded chips measure ≥12px), afterRenderEffect
auto-disposes, `mixedReadWrite` phase is correct for the fused
read+write Material call. Both fixed behaviors contractually unchanged.

**AFTER captures refreshed** (`__screenshots__/21-entry-drawer-ux/after/`,
9 shots, identical pinned conditions — same script/contexts/theme/fixture/
settle) on the final tree (`3935762`). Capture-script adjustments (logged
per the task-12 hygiene precedent; no pinned condition — viewport/theme/
fixture/settle — changed): key adds are now paced (qa's zoneless-flush
finding — a machine-speed Enter loop drops keys) and the settled-state gate
pins counter CONSISTENCY (`+N` = 6 − visible) instead of the round-1 magic
`+3`, which the dynamic fit made width-dependent; on phones the gate runs
after the drawer reopens (the unmeasured closed-drawer state renders all
chips with no counter by design).

**After-state probe** (probe-after.mjs, same conditions as the before probe):

| viewport | list overflow | Duplicate beyond viewport @ scrollLeft=0 | title ellipsizes | drawer width |
|---|---|---|---|---|
| desktop 1280×800 | 0px | inside by 64px | yes | 320px |
| tablet 1024×768 | 0px | inside by 64px | yes | 320px |
| mobile 390×844 | 0px | inside by 68px | yes | 390px (full width) |

**Full three-project Playwright matrix** (one project per command):

- `desktop-chrome`: 86 passed, 20 skipped (4.5m)
- `mobile-chrome`: 50 passed, 56 skipped (3.2m)
- `mobile-safari`: 48 passed, 58 skipped (4.6m)

No red spec — no fix-forward loop needed at the sweep.

**Closing gates**: `CI=true npm test -- --watch=false --coverage` ✓ 63
files, 1446/1446, thresholds enforced in-run · `npm run lint` ✓ all files
pass.

**Branch pushed** for user testing: `origin/feature/21-entry-drawer-ux`.
Never self-merged — `git merge --ff-only` into `develop` waits for the user's
explicit go. On the go: archive this ledger beside the plan (Task 02
precedent), flip the README row. Release cut is NOT part of this task.

### Commits on the branch

| SHA | Message |
|---|---|
| `1c6b03f` | docs(next_tasks): plan task 21 entry drawer ux |
| `817e736` | fix(entry-list): truncate long titles and key chips instead of scrolling |
| `4732209` | feat(entry-list): full-width mobile entries drawer with close button |
| `e60c94f` | feat(shell): resizable docked entries drawer |
| `2ea657f` | refactor(shell): end an in-flight drawer resize drag on viewport band flips |
| `dcaf963` | test(e2e): pin drawer truncation, mobile full-width and resize contracts |
| `5989f8c` | fix(entry-list): ellipsize key chip labels instead of slicing chips (round 2; superseded by round 3) |
| `93785fa` | fix(shell): give the entries resize handle a persistent visible affordance |
| `c045f19` | fix(shell): recompute content margins as the entries drawer resizes (superseded by ec48990) |
| `cf18871` | fix(entry-list): fit whole key chips and count the overflow in the +N chip |
| `9238784` | refactor(entry-keys): route fonts access through the DOCUMENT token |
| `ec48990` | fix(shell): recompute content margins after the width binding applies |
| `2e9ccb6` | fix(entry-list): recover the key-strip fit when the drawer reopens |
| `3935762` | test(e2e): pin full-chip overflow counting and content-margin recovery |
| (+ per-phase `docs(next_tasks)` ledger commits) | |

---

## Close-out

- **Status**: ✅ merged — user go 2026-09-29; released the same day as v1.9.0
  (`e6db8f0`, annotated tag `v1.9.0`). The plan and this ledger still sit in
  `next_tasks/` pending the archival move (the 12/16–20 precedent).
