# Task 25 — PWA Update Prompt (reload into a new version)

> **Source**: user request (2026-10-01) — "is there a way for the PWA to update
> when I push a new update?" The service worker already propagates new versions
> on next launch; this task closes the in-session gap (open/suspended app stays
> old until relaunch). Slotted by user decision (task-12 precedent) — preempts
> the queue.
> **Type**: Shell wiring over an existing Angular service — no core/model
> surface, no new visual language (Material snackbar; in-app exemplar cited in
> §3.2).
> **Suggested agents**: `ui-specialist` (lead) → `ts-reviewer` → `qa-auditor`.
> `core-engine` is not dispatched — nothing touches serialization, VCS or
> hashing.
> **Status**: 🟢 Implemented on `feature/25-pwa-update-prompt` (pushed
> 2026-10-01, awaiting user test — no merge until the explicit go)

---

## 1. Objective

When a new app version has been downloaded by the service worker while the app
is open, the shell offers exactly one snackbar — "A new version is available."
with a **Reload** action. Accepting it flushes pending work and reloads into
the new version immediately; ignoring it changes nothing (the default
next-launch activation still applies). While the app is visible, a returning
`visibilitychange` re-checks for updates, so a deployed release reaches
long-running sessions (installed/suspended PWAs, iOS especially) without a
relaunch.

## 2. Gap analysis (develop @ `5e142ac`)

The app is already a PWA: `provideServiceWorker('ngsw-worker.js', { enabled:
!isDevMode(), registrationStrategy: 'registerWhenStable:30000' })
(`app.config.ts:19-22`) and two `prefetch` asset groups (`ngsw-config.json`).
`provideServiceWorker` unconditionally provides `SwUpdate` + `SwPush`
(`@angular/service-worker` fesm — injectable in every mode; `isEnabled ===
false` when disabled). Nothing consumes `SwUpdate` today (`grep SwUpdate src/
e2e/` → no hits).

What exists and is reused verbatim:

| Need | Exists at |
|---|---|
| Shell-owned cross-cutting prompt wiring (state fan-out → snackbar/reload) | session-lock surface, `app.ts:105-112` + state effect `app.ts:322-352` |
| Snackbar exemplar (copy, action label, duration) | blocked-attempt snackbar `app.ts:348-350`; `ProjectActionsService` duration conventions (3000–5000 ms) |
| Flush-before-destructive-transition primitive | `WorkspaceService.flushPendingSave()` (`workspace.service.ts:581`, public async) — the session-lock release path already routes through it |
| Wait-out-the-edit-window idiom | `EDIT_COMMIT_DEBOUNCE_MS = 300` (`entry-editor.constants.ts:36`); drafts commit via internal `commitDraft` (`entry-edit-form.ts:203,329`) — **no public draft-flush API exists** (grep `flushDraft|commitDraft`), so the reload path waits the window out instead of adding one |
| Shell wiring test precedent (real service, overridden edge) | `app.spec.ts:1083-1111` (session-lock section) |

Mechanics driving the design (verified against the Angular SW contract):

- `versionUpdates` emits `VERSION_READY` once per new version that has been
  installed and is waiting; repeated `checkForUpdate()` of the same version
  does not re-emit → **no dedupe state needed**.
- The browser's own ~24 h re-fetch only matters when `ngsw-worker.js` itself
  changes (rare); `ngsw.json` changes every deploy. LoreStitch has no router —
  no in-app navigations trigger checks — so a long-open session would
  otherwise never learn about a deploy. The `visibilitychange` re-check is the
  load-bearing half of this task, not polish.
- Reloading closes the old page, which activates the pending version — no
  `activateUpdate()` dance needed.
- Headless shells never fire real visibility transitions (AGENTS.md) — the
  capture script dispatches a synthetic `visibilitychange` event; the app's
  listener keys on `visibilityState === 'visible'`, which stays true, so the
  listener runs the real check path.

## 3. Design (pre-locked, ponytail rung 2 — reuse the shell, zero new files)

### 3.1 Shell wiring — `app.ts` only

One field, one guarded constructor block, two small private methods; ~35 lines
with house-density comments. No service, no signal, no new module.

```ts
private readonly updates = inject(SwUpdate);

// in the constructor, after the session-lock section:
if (this.updates.isEnabled) {
  this.updates.versionUpdates
    .pipe(takeUntilDestroyed(this.destroyRef))
    .subscribe((evt) => {
      if (evt.type === 'VERSION_READY') this.offerUpdate();
    });
  this.document.addEventListener('visibilitychange', UPDATE_VISIBILITY_CHECK, { passive: true });
}
// + destroyRef.onDestroy removal of the listener
```

- `versionUpdates` is an event stream, not state — a `takeUntilDestroyed`
  subscription is the correct shape; the Signals-over-RxJS rule governs state,
  and ts-reviewer is briefed not to flag this (pre-empted here).
- Visibility handler (module-scope named fn so add/remove share one identity):
  `if (document.visibilityState === 'visible') void updates.checkForUpdate().catch(() => {})`
  — hidden transitions don't check; failures are ignored (offline is normal).
- `offerUpdate()`:
  `this.snackBar.open('A new version is available.', 'Reload', { duration: 10000 })`
  then `ref.onAction().subscribe(() => void this.applyUpdate())`. Duration
  lapse = silent dismissal (next launch gets the version anyway); a second
  `VERSION_READY` (rapid successive deploys) simply replaces the snackbar —
  latest wins, no guard.
- `applyUpdate()` (order is the data contract):
  1. `await` one `EDIT_COMMIT_DEBOUNCE_MS` window — a draft mid-debounce must
     commit to workspace state first (no public draft-flush exists; adding one
     for 300 ms of typing is over-engineering — house e2e already waits this
     window out as `EDIT_COMMIT_FLUSH_MS` precedent);
  2. `await this.workspace.flushPendingSave()` — IndexedDB truth matches
     workspace state (the session-lock release contract);
  3. `this.document.location.reload()` — activates the pending version.
- `isEnabled === false` (dev server, default unit-test mode) skips the whole
  block: no listener, no subscription, inert.

### 3.2 Copy & design evidence

Snackbar copy is exactly: message "A new version is available.", action
"Reload", 10 s duration. Design-checkpoint evidence is satisfied by citing the
in-app exemplar (blocked-attempt snackbar, `app.ts:348`) — same component, same
styling, only copy differs; no mock required for a standard snackbar. The copy
itself is posted to the user in the P1 phase report.

### 3.3 Deliberately NOT in this task

- No `ConfirmDialog`/responsive overlay — the prompt is non-destructive and
  self-healing (miss it → next-launch activation), so a modal is over-kill.
- No update-available badge, no "current version" surface — the About/changelog
  work is release-time (`chore(release)` convention).
- No prod-serve Playwright project — one real-SW capture (§4.3) covers the
  validation need without growing the e2e matrix.
- No `activateUpdate()`/SW-internal plumbing beyond `checkForUpdate`.

## 4. Tests

### 4.1 Unit — `app.spec.ts` (session-lock section precedent)

`TestBed.overrideProvider(SwUpdate, { useValue: fake })` — a fake with a
subject-backed `versionUpdates`, `isEnabled: true`, spied `checkForUpdate`.
Fake timers per the house convention
(`vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })`). Specs:

1. `VERSION_READY` → snackbar shown with message + Reload action.
2. Action click → advances the 300 ms window → `flushPendingSave` called →
   reload requested. Reload assertion: `document.location.reload` in jsdom
   throws "Not implemented: navigation" — stub/spy it via the component seam
   or `Object.defineProperty` before the click; assert the stub, not the
   throw.
3. `isEnabled: false` → emit on the subject → no snackbar; visibilitychange →
   no `checkForUpdate`.
4. visibilitychange: visible → `checkForUpdate` called once; hidden → not
   called; listener removed on destroy (no post-destroy fire).

### 4.2 E2E — none authored

The SW is disabled on the dev server (`enabled: !isDevMode()`), which Playwright
boots; no spec could observe the real path without a production-serve project.
`npm run typecheck:e2e` still runs (gate), but no spec is written or migrated.

### 4.3 Real-SW capture (qa phase) — `__screenshots__/25-pwa-update-prompt/`

The only place the real service-worker path gets exercised end to end, as a
gitignored capture script (the `__screenshots__/linter/capture.mjs` precedent):

1. `npm run build` → serve `dist/lore-stitch/browser` on a free port via a
   small stdlib node server in the script (no new dep; correct MIME; no cache
   headers on `ngsw-worker.js`/`ngsw.json`).
2. Load the app, wait for stability + SW registration
   (`registerWhenStable:30000` — a quiet page settles well inside it).
3. Rebuild (the build-info/asset hash churn guarantees a different
   `ngsw.json`), re-serve, dispatch a synthetic `visibilitychange` on the
   page.
4. The real check runs → `VERSION_READY` → snackbar appears; screenshot the
   `after/` set. `before/` = the same settled page before the swap, identical
   pinned conditions: same browser, viewports 1280×800 / 1024×768 / 390×844,
   one explicit theme, same seeded project.

The script doubles as manual regression tooling for future deploy hygiene
(cache-header mistakes, broken hash churn) — noted in the README row.

## 5. Phases & gates

| Phase | Agent | Work | Gate |
|---|---|---|---|
| P0 | orchestrator | Re-ground this plan at HEAD (file anchors above); branch `feature/25-pwa-update-prompt` off `develop`; commit plan + `next_tasks/README.md` row | plan committed |
| P1 | `ui-specialist` (skills: `angular-developer`, `ponytail`) | §3.1 wiring + §4.1 specs | build + scoped spec run, self-reviewed |
| P2 | `ts-reviewer` (skills: `typescript-advanced-types`, `ponytail`) | typing/lint review; ladder check: confirm no service/file was warranted; any refactor lands before QA | `npm run lint` green on its diff |
| P3 | `qa-auditor` (skills: `playwright-cli`, `angular-developer`, `ponytail`) | Fast gate: `npm run build`, `CI=true npm test -- --watch=false --coverage`, `npm run lint`, `npm run typecheck:e2e` (no e2e smoke — no spec touched); then §4.3 capture + evidence pack | all four green; before/after posted |
| P4 | orchestrator | Branch-final sweep: three-project matrix one `--project=` at a time, closing `npm test --coverage` + `npm run lint`; ledger archive-ready; push branch, **stop** (no merge — user tests first) | matrix green |

Ledger: `next_tasks/25-PROGRESS.md` after every phase
(`docs(next_tasks): task 25 phase P progress`), pushed with the branch.
Every command under ~8 minutes; Playwright per project, never one monolithic
run. A red gate loops back to the owning phase (fix-forward); two consecutive
failed fixes → stop and escalate with output. A cancelled subagent leaves
partial work — audit `git status`/`git stash list` before re-dispatching.

## 6. Sign-off & human gates

- **No hard gate**: exported bytes, entry `content` output and pinned test
  behavior are untouched (wiring is additive; no spec migrates).
- Posted for review, not blocking: the snackbar copy (§3.2) and the
  before/after screenshot comparison ride the P1/P3 phase reports.
- Standard user gate: branch is pushed and stops — merge to `develop` only
  after manual testing.

## 7. Commit plan

| Commit | Phase | Message |
|---|---|---|
| Plan + README row | P0 | `docs(next_tasks): plan task 25 pwa update prompt` |
| Wiring + specs | P1 | `feat(pwa): prompt reload when a new version is ready` |
| Review refactor (if any) | P2 | `refactor(pwa): ...` (only if ts-reviewer lands changes) |
| Ledger | each | `docs(next_tasks): task 25 phase P progress` |

Capture script and screenshots stay gitignored (`__screenshots__/`); evidence
lands in the ledger + phase report, not the tree.
