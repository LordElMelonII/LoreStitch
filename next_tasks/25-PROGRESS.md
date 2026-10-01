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
