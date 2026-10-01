# Task 25 Progress Ledger

Plan: [25-pwa-update-prompt.md](./25-pwa-update-prompt.md) (user request
2026-10-01, slotted by decision; preempts the queue).
Branch: `feature/25-pwa-update-prompt` (off `develop` @ `5e142ac`).

## Phase P0 — Re-ground + branch (orchestrator)

**Status**: ✅ complete — commit `f08c1a0` `docs(next_tasks): plan task 25 pwa update prompt`

Re-grounding at HEAD `5e142ac` (the plan's own grounding commit — no commits
landed in between): every §2 anchor verified exact, no drift to refresh.

- `app.config.ts:19-22` — `provideServiceWorker('ngsw-worker.js', { enabled:
  !isDevMode(), registrationStrategy: 'registerWhenStable:30000' })` ✅
- `ngsw-config.json` — two `prefetch` asset groups (installMode 7, 23; updateMode
  24) ✅
- `app.ts:105-112` session-lock surface · `app.ts:322-352` state effects ·
  `app.ts:348-350` blocked-attempt snackbar ✅
- `workspace.service.ts:581` — `async flushPendingSave(): Promise<void>` ✅
- `entry-editor.constants.ts:36` — `EDIT_COMMIT_DEBOUNCE_MS = 300` ✅
- `entry-edit-form.ts:203,329` — `commitDraft` internal (also 338); grep
  `flushDraft|commitDraft` confirms no public draft-flush API ✅
- `app.spec.ts:1082+` — session-lock describe block (plan said 1083-1111;
  block starts 1082, same section) ✅
- `grep SwUpdate src/ e2e/` → no hits ✅

**Next**: P1 — ui-specialist implements §3.1 wiring + §4.1 app.spec suite
(`feat(pwa): prompt reload when a new version is ready`).

## Phase P1 — Shell wiring + specs (ui-specialist)

**Status**: ✅ complete — commit `f3c3d30` `feat(pwa): prompt reload when a new version is ready` (2 files, +289/−4; working tree clean after)

**Landed**:
- `src/app/app.ts` — §3.1 wiring exactly as planned: `updates = inject(SwUpdate)`
  field beside the session-lock block; guarded constructor section after the
  session-lock effects (`isEnabled` gate → `versionUpdates` piped
  `takeUntilDestroyed` → `VERSION_READY` → `offerUpdate`; `visibilitychange`
  listener `{ passive: true }` + `destroyRef.onDestroy` removal);
  `offerUpdate()` = snackbar `"A new version is available."` / `Reload` /
  10000 ms (exemplar: blocked-attempt snackbar, same component); `applyUpdate()`
  = `EDIT_COMMIT_DEBOUNCE_MS` window → `flushPendingSave()` → `location.reload()`.
- `src/app/app.spec.ts` — §4.1 suite `describe('App PWA update prompt')` (4
  specs: VERSION_READY→snackbar; action→window→flush→reload order with
  pre-window flush assert; `isEnabled: false` inert; visible-recheck +
  hidden-no-check + post-destroy listener removal) + inert
  `SwUpdate` fakes injected into the two pre-existing describes.

**Gates**: `npm run build` green (re-run after final formatting) · scoped
`npx ng test --filter="^App"` 42/42 (4 new + 38 existing, the two describes'
pins preserved) · `npx tsc -p tsconfig.spec.json --noEmit` green · prettier
clean on both touched files. Full suite/lint/typecheck:e2e deferred to P2/P3
per plan §5.

**Deviations** (all blocker-removals, orchestrator-audited against the diff):
1. **Visibility handler shape**: the plan's verbatim module-scope listener
   can't close over the injected `SwUpdate`; implemented as module-scope
   `checkForUpdateIfVisible(updates)` registered through one constructor-local
   wrapper — the single-identity property (add/remove share one fn, pinned by
   the post-destroy spec) is preserved.
2. **Reload stub seam**: jsdom's `document.location`/`location.reload` are
   non-configurable own properties, so `Object.defineProperty` is impossible
   (probe-verified); the block overrides `DOCUMENT` with a transparent proxy
   serving a stub location only while a spy is armed (the plan's named
   component-seam alternative).
3. **Inert fakes in the two existing describes** (forced): `SwUpdate` is
   provided only by `provideServiceWorker`, never root-provided — `App`'s new
   `inject(SwUpdate)` needs a provider in every test mount; `isEnabled: false`
   keeps all pre-task pins (38 existing tests green).

**Snackbar copy posted to user (§3.2)**: message `A new version is available.`
· action `Reload` · duration 10000 ms.

**Next**: P2 — ts-reviewer typing/lint review of the `f3c3d30` diff + ladder
check (`npm run lint` green on its diff; refactor, if any, lands as its own
commit).

## Phase P2 — Typing/lint review (ts-reviewer)

**Status**: ✅ complete — one refactor commit `e8cfdf8` `refactor(pwa): satisfy no-empty-function in the update-check catch` (comment-only, +3/−1)

**Verdicts**:
- **Typing PASS**: no `any`/assertions; explicit return types throughout;
  `VersionEvent` discriminated-union narrowing correct; `applyUpdate` order
  matches the data contract (flush internally try/catch-guarded → no unhandled
  rejection can precede the reload). `onAction()` verified self-terminating in
  the Material source (completes on action click and on duration dismissal) —
  not a dangling subscription. `makeSwUpdateFake` cannot structurally satisfy
  `SwUpdate` (private ctor param) — `overrideProvider`'s `useValue: any` is the
  only viable, platform-sanctioned seam; no `any` written in the spec, shape
  pinned via `ReturnType<typeof makeSwUpdateFake>`. `shellDocument` proxy traps
  contextually typed by `ProxyHandler<Document>`; the armed `{ reload }` lie is
  deliberate, documented, confined to one spec, disarmed in `finally`.
- **Lint — ONE finding, fixed**: `@typescript-eslint/no-empty-function` on the
  `.catch(() => {})` — fixed with the rule's documented comment escape hatch
  (`e8cfdf8`, zero behavior change). `npm run lint` green on HEAD;
  `npx tsc -p tsconfig.spec.json --noEmit` exit 0.
- **Reactivity PASS (pre-briefed)**: the `versionUpdates` subscription is
  event-stream consumption with `takeUntilDestroyed(this.destroyRef)`; TestBed
  default teardown destroys fixtures, so no cross-test listener leak.
- **Ladder CONFIRMED (rung 2)**: zero new files; no update service / signal
  wrapper / config knob / dedupe state warranted — no finding named a concrete
  blocker. Collapsing `checkForUpdateIfVisible` into an arrow was considered
  and rejected (not a defect; the named fn carries the doc contract).

**Residual notes for qa-auditor**: (1) spec 2 arms fake timers after the
snackbar opens — the 10 s duration timer rides the real clock; any future
duration-dismissal assertion must fake timers before `open()`. (2) The PWA
describe overrides `DOCUMENT` for the whole mount — new specs there must keep
the disarm-in-`finally`/`afterEach` discipline. (3) Spec 4's `visibilityState`
shadow cleans up via `Reflect.deleteProperty` in `finally` — no residue.

**Next**: P3 — qa-auditor fast gate (`npm run build`, `CI=true npm test --
--watch=false --coverage`, `npm run lint`, `npm run typecheck:e2e`; no e2e
smoke — no spec touched, plan §4.2) + §4.3 real-SW capture under
`__screenshots__/25-pwa-update-prompt/` + before/after evidence pack.

## Phase P3 — Fast gate + real-SW capture (qa-auditor)

**Status**: ✅ complete — no repo commit (all deliverables gitignored under `__screenshots__/`, per plan §7)

**Fast gate — ALL FOUR GREEN**:
- `npm run build` green (16.5 s).
- `CI=true npm test -- --watch=false --coverage` green: 64 files / **1485/1485**
  passed (47.6 s). Coverage 96.00 statements / 90.62 branches / 91.77 functions
  / 96.99 lines — all above thresholds (80/75/80/80); `app.ts` + `app.spec.ts`
  fully covered, the 4 PWA specs ran in-suite.
- `npm run lint` green ("All files pass linting").
- `npm run typecheck:e2e` green.
- No e2e smoke (plan §4.2 — the Playwright dev server has the SW disabled; no
  spec touched). Process note: qa's first gate-2 run was piped through `tail`
  (masked exit code) — re-run with full capture; both runs identical 1485/1485.

**§4.3 capture** (`__screenshots__/25-pwa-update-prompt/`): `capture.mjs`
(stdlib `node:http` server, free port, full MIME map, `no-cache` on everything
incl. `ngsw-worker.js`/`ngsw.json`; refuses to run if the two builds'
`ngsw.json` are identical — the empirical A/B guard) + before/after PNG sets
at 1280×800 / 1024×768 / 390×844 (light theme pinned, Fuyuki fixture via the
real import path, linter-capture conventions reused).
- Two consecutive `npm run build`s produced **natively different**
  `ngsw.json` — the plan's churn assertion confirmed; perturb fallback unused,
  tree clean throughout.
- Label drift caught by probing: welcome import button is now "Import lorebook
  or character card" (the linter precedent's label was stale).
- Controller reload NOT needed — ngsw's `clients.claim()` made every first
  load controller-owned (script polls; reload was the fallback).
- Real chain verified per viewport: build swap → synthetic `visibilitychange`
  → app listener → `checkForUpdate()` → fresh manifest → `VERSION_READY` →
  snackbar. Swap alternation A→B / B→A / A→B — prompt fires on any differing
  manifest.
- Geometry measured: snackbar bottom ≤ viewport at all three (792≤800,
  760≤768, 836≤844 — fully on-screen, visually confirmed in the PNGs).
- Deviations: builds served from gitignored `serve/{buildA,buildB,live}` temp
  copies (build B would overwrite `dist/`); otherwise none.

**Evidence for user**: before = settled project-open page, no prompt;
after = snackbar `A new version is available.` + `Reload` visible at every
viewport. Paths posted in the phase report to the user.

**Next**: P4 — branch-final sweep (three-project Playwright matrix one
`--project=` at a time, closing `CI=true npm test -- --watch=false --coverage`
+ `npm run lint`), ledger final entry + README status, push branch, STOP.
