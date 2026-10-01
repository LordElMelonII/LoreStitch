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
