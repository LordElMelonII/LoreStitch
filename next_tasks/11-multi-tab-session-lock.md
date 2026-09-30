# Task 11 — Multi-Tab Session Lock

> **Source**: ROADMAP.md (LOW PRIORITY) — *"Avoids IndexedDB overwrites across
> simultaneous browser tabs without over-engineering multi-device conflict
> resolvers."*
> **Type**: Data-loss guard (concurrency), small UI surface
> **Suggested agents**: `core-engine` (lead: lock service + write gating) →
> `ui-specialist` (takeover prompt, notice, editor veil) → `ts-reviewer` →
> `qa-auditor`
> **Status**: 🟢 Implemented on `feature/11-multi-tab-session-lock`
> (2026-09-30 — all phases + branch-final sweep green, checkpoint 11-1
> answered; ledger in [11-PROGRESS.md](./11-PROGRESS.md). Awaiting user
> manual test before the ff-only merge to `develop`.)

---

## 1. Objective

At most one tab per browser profile edits a given project at a time. A second
tab that opens the same project while another holds it sees a non-destructive
takeover prompt — **taking over flushes the losing tab's pending save first,
so no edit is ever discarded** — and the losing tab degrades to a read-only
notice (editor veiled) instead of silently clobbering. Two tabs editing two
*different* projects both work. The multi-device conflict resolvers the
roadmap explicitly rejects stay out of scope.

## 2. Gap analysis (develop @ `6c5aec5`, 2026-09-30)

Two tabs = silent last-writer-wins on the whole `ProjectWorkspace` record:

- Book edits end in `mutateProject` → `storage.scheduleSave(next)`
  (`workspace.service.ts:508-516`), which debounces ~400 ms and then `put`s
  the **entire project object** (`storage.service.ts:121-137`). Two tabs
  holding divergent in-memory copies of the same project interleave
  whole-record puts: the slower tab's write erases the faster tab's edits
  with no error anywhere.
- **The write surface is wider than `mutateProject`**: `commit()`
  (`workspace.service.ts:479-489`) and `rollbackTo()` (`:491-501`) write via
  direct `activeProject.set` + `storage.saveProject`; `createProject`
  (`:109`), `startProjectFromBook` (`:166`), `openImportedWorkspace`
  (`:193`) and `deleteProject` (`:137`) also persist directly. A gate on
  `mutateProject` alone misses the VCS and lifecycle paths. All of them live
  in `WorkspaceService` — one file to gate (grep: no other caller of
  `storage.saveProject`/`scheduleSave`/`deleteProject` outside the service
  and its specs).
- `WorkspaceService.init` auto-reopens the most recent project in **every**
  tab (`workspace.service.ts:93-103`, `LAST_PROJECT_KEY`) — so the collision
  is the default two-tab experience, not an edge case.
- `StorageService.getProject` prefers the in-memory `pendingProjects`
  snapshot (`storage.service.ts:74-82`) — correct in-tab, invisible
  cross-tab: the other tab's newer write is never noticed.
- Nothing in `src/` uses `navigator.locks` or `BroadcastChannel` (grep:
  0 hits) — greenfield. Unit tests run under jsdom (no `navigator.locks`,
  `matchMedia` already stubbed there — the `src/testing/match-media-stub.ts`
  precedent for installing platform fakes).
- The pre-existing save-state affordance (topbar icon + tooltip for
  `workspace.saveError`, `topbar.html:36-46`) covers persistence *failure*;
  this task covers persistence *racing*, which today fails silently and only
  surfaces as "my edit vanished" after a reload.
- Related single-tab hole: an edit commits to memory on the 300 ms
  `entrySliceSignal` debounce, then sits on the 400 ms storage debounce —
  closing the tab inside that window loses it with no second tab involved.

## 3. Design

### 3.0 Locked decisions (user, 2026-09-30)

1. **Per-project lock** — name `lorestitch-project:<id>`, acquired when a
   project becomes active, released on close/delete/switch. Two tabs on two
   different projects both edit; no prompt on the welcome screen (no project
   open = no lock); `LAST_PROJECT_KEY` fights are moot. Data protection is
   equivalent to session-level: `appState` holds only the benign
   last-opened key.
2. **Web Locks only** — no BroadcastChannel heartbeat/election fallback.
   Every evergreen browser ships `navigator.locks` (Chrome 69+, Firefox
   96+, Safari 15.4+); when absent (jsdom, older webviews) the service
   degrades straight to `held` = today's status quo for those browsers.
   `BroadcastChannel` stays as the takeover **handshake** channel only.
3. **Read-only feedback = editor veil + snack elsewhere** — the entry editor
   pane gets one read-only veil; every other gated attempt fires the
   read-only snackbar from the same chokepoint that blocks it.
4. **Blocked tab boots into the project read-only** — keep auto-open; the
   takeover prompt appears over the real data.
5. **`pagehide` flush included in P1** (see §3.5).
6. **Stale-block recovery = re-probe** on `visibilitychange`/focus + a slow
   (~30 s) timer (see §3.4).

### 3.1 Lock service — `core/services/session-lock.service.ts`

`@Service()` in core (platform APIs are fine in core, Angular UI is not).
One instance owns at most one project lock — the active project's. A single
`BroadcastChannel('lorestitch-project-lock')` carries the handshake; every
message carries the `projectId` and listeners filter (a third tab blocked on
another project ignores it).

```ts
export type SessionLockState =
  | 'idle'          // no project open — nothing locked
  | 'acquiring'     // probe in flight — writes allowed (see §7.3)
  | 'held'          // this tab owns the project's lock
  | 'blocked'       // another tab owns it; takeover prompt territory
  | 'relinquishing' // takeover requested; flushing + releasing
  | 'lost'          // we gave the lock away; read-only

@Service()
export class SessionLockService {
  readonly state = signal<SessionLockState>('idle');
  /** True only while this tab may mutate the attached project. */
  readonly canEdit = computed<boolean>( /* held | acquiring */ );
  /** Fired (signal pulse) on every write attempt made while !canEdit. */
  readonly blockedAttempt = signal(0);
  /** Attach on setActive; registers the flush run before any release. */
  attach(projectId: string, hooks: { flush: () => Promise<void> }): void;
  /** Detach on close/delete/switch — own flush, then release, → idle. */
  detach(): void;
  /** From `blocked`/`lost`: ask the holder to relinquish, then acquire. */
  takeover(): Promise<void>;
}
```

Mechanics:

- **Attach/probe**: `navigator.locks.request('lorestitch-project:<id>',
  { ifAvailable: true }, grant)` — grant ⇒ `held`; `undefined` (taken) ⇒
  `blocked`. Holding: a real request whose `grant` returns a promise that
  resolves only at release (the standard hold-for-tab-lifetime pattern).
  The db-rejection lesson from `storage.service.ts:38-45` applies: mark
  pending request promises handled up front so jsdom/Node never reports an
  unhandled rejection.
- **Takeover handshake** (non-destructive is the whole point): `takeover()`
  queues a real (blocking) lock request FIRST, then posts
  `{ type: 'takeover-request', projectId }` on the channel → the holder
  runs its registered `flush()` **before** releasing the lock
  (`workspace.flushPendingSave`, `workspace.service.ts:523-528`), then
  enters `lost`; the requester's queued request grants ⇒ `held`, and the
  shell reloads the project from storage (§3.3). A holder that never
  answers (hung tab) leaves the requester `blocked` with the notice's
  retry affordance — `steal: true` exists in the Web Locks spec but is
  deliberately excluded: it releases the holder without cooperation, so
  no flush runs (destructive — the exact thing this task removes) and
  its cross-browser support is uneven.
- **Detach** (close/delete/switch): flush own pending save, release, →
  `idle`. Detaching from `blocked`/`lost` just clears state (this tab
  holds nothing).
- **Absent APIs**: no `navigator.locks` ⇒ `held` immediately (single-tab
  assumption; no test suite ever blocks on it).
- **Platform seams for specs**: read `navigator.locks` and
  `BroadcastChannel` off globals lazily; unit specs install fakes on
  `globalThis` before service construction (the
  `installMatchMediaStub` precedent — no InjectionToken ceremony, and
  never rely on jsdom's own BroadcastChannel, if present).

### 3.2 Write gating — `WorkspaceService`, the one file every write lives in

`WorkspaceService` injects `SessionLockService`; `setActive` calls
`attach(project.id, { flush: () => this.flushPendingSave() })`, and
close/delete/switch paths `detach()` first. The gate: when
`sessionLock.canEdit()` is false, the write paths below early-return and
pulse `blockedAttempt` (the shell turns that into the snackbar, §3.3):

- `mutateProject` (`:508`) — every book/prefs/rename edit (covers batch
  ops, delimiters apply, search & replace, repair apply);
- `commit()` (`:479`), `rollbackTo()` (`:491`) — the VCS direct-write paths;
- `deleteProject` (`:137`) — destructive, gated for the active project;
- **not gated**: `createProject` / `startProjectFromBook` /
  `openImportedWorkspace` — they create a fresh id and `attach` to it
  (nobody else holds a new uuid's lock), so a blocked tab may still start
  or import a NEW project and edit it; `openProject`/`setActive`'s
  `LAST_PROJECT_KEY` write is benign metadata.

`StorageService.scheduleSave` gains the same `canEdit`-shaped check as
defense in depth (it is the door the debounced timer walks through — the
check must re-run when the timer *fires*, not only when it is scheduled, so
a save scheduled while `relinquishing` can never land after `lost`).
`saveProject`/`flush` themselves stay ungated — the relinquishing holder
must write through them. Tab bookkeeping (`openEntry`, `activeTabId`) stays
live; browsing a read-only tab is harmless.

### 3.3 Shell surface — `app.ts` wiring, `topbar` notice, `entry-editor` veil

- **Takeover prompt** on the first `blocked` entry per streak: the
  `ConfirmDialog` exemplar
  (`shared/components/confirm-dialog/confirm-dialog.ts`, data-driven
  shape) opened through `ResponsiveOverlayService.openResponsive`
  (dual-container invariant). Copy sketch for checkpoint 11-1: title
  "Project open in another tab", body naming the project and explaining
  the other tab keeps its edits and this one can take over safely,
  actions **Take over** (primary) and **Stay read-only** (dismiss).
  Prompt frequency when the same project is re-opened into `blocked`
  again: decided at checkpoint 11-1.
- **Read-only notice** while `blocked` (after dismiss) or `lost`:
  the save-error topbar precedent (`topbar.html:36-46`) — icon + tooltip +
  `aria-label`, visible on **phones too** (the save-error comment's rule).
  Carries the "Take over" retry action for `blocked`/`lost` alike.
- **Editor veil** while `!canEdit`: one surface over the entry editor pane
  — `pointer-events: none`, `aria-disabled`, lock icon + one-line
  explanation (final chrome at checkpoint 11-1). Typed-into-the-void is
  the failure mode this task exists to kill; the veil is what kills it.
- **Blocked-attempt snackbar**: shell effect on `blockedAttempt` —
  "Read-only — this project is held by another tab" (reuse
  `expectSnackbar` in e2e).
- **Reload on acquire**: whenever the lock lands on `held` after being
  `blocked`/`lost` (takeover OR spontaneous re-probe), the shell calls
  `workspace.openProject(activeProject().id)` so the tree and forms
  re-derive from the flushed storage state (a blocked tab's memory is
  stale relative to the holder's *saved* edits; `entrySliceSignal`
  re-seeds its form slice on entry replacement — `entry-edit-form.ts`
  reseed effect — so any in-form draft heals).

### 3.4 Stale-holder recovery — re-probe

The holder closing/crashing without the handshake releases the lock
silently; Web Locks notifies no one but queued requesters. The blocked tab
re-probes (`{ ifAvailable: true }`) on `visibilitychange`/document focus
and a ~30 s timer while `blocked`/`lost`. Probe success ⇒ `held` ⇒ the
same reload-on-acquire path as takeover. No holder heartbeat — that is the
election machinery decision 3.0.2 removed.

### 3.5 `pagehide` flush (P1)

On `pagehide` and `visibilitychange → hidden`, run the active project's
`flush()` (cancel the 400 ms debounce, start the IndexedDB write now).
Best-effort on unload (the browser may not finish the transaction),
reliable on hide (tab switch, minimize, phone screen off). Protects the
single-tab close-inside-debounce window and the holder-close case, with
the same code path the takeover handshake uses.

### 3.6 Test matrix

| Tier | Required cases |
|------|----------------|
| Unit — `session-lock.service.spec.ts` (fake `navigator.locks` + fake `BroadcastChannel` on `globalThis`) | probe free ⇒ `held`, taken ⇒ `blocked`; absent APIs ⇒ `held`; takeover: `takeover-request` runs `flush` **before** release (order pin); `relinquished`-then-grant ⇒ `held`; hung holder ⇒ stays `blocked` (retry re-posts); detach flushes then releases ⇒ `idle`; re-probe on focus/timer flips `blocked` ⇒ `held` after holder release; third-project messages filtered |
| Unit — write gating (`workspace.service.spec.ts` additions) | `mutateProject`, `commit`, `rollbackTo`, `deleteProject` no-op + pulse while `blocked`/`lost`/`relinquishing`; `openEntry` still works; create/import paths still work from a blocked tab (fresh lock); `scheduleSave` timer fired while gated never writes |
| Unit — shell (`app.spec.ts`, `topbar.spec.ts`, `entry-editor` veil spec) | prompt opens once per `blocked` streak; Take over ⇒ `takeover()` + `openProject` reload; dismiss ⇒ notice + veil; `blockedAttempt` ⇒ snackbar; notice present on mobile band; veil blocks pointer events and announces read-only |
| E2E — new `e2e/session-lock.spec.ts` (two pages, one context) | page A imports the fixture and types into an entry (wait out `EDIT_COMMIT_FLUSH_MS`, round-trip.spec precedent); page B (`context.newPage()`) auto-opens the same project and shows the takeover prompt; B clicks **Take over** ⇒ A shows the lost notice + veil **and** B's editor shows A's typed edit (the flush-before-release proof — the non-destructive pin); B edits afterwards; two-different-projects pass (A on project 1, B creates project 2 — no prompt, both editable); stale-holder pass (B dismissed the prompt, `page.close({ runBeforeUnload: true })` on A, `bringToFront()` on B ⇒ notice clears, editing resumes, A's saved edit visible); `pagehide` pass (A types, closes via `runBeforeUnload`, fresh page sees the edit) |

**Visual gate**: prompt + notice + veil are new UI ⇒ before/after
screenshots under `__screenshots__/11-session-lock/{before,after}/` (pinned
conditions per the baseline protocol — before = today's silent second tab /
after = prompt, notice, veil), driving the real app per the
`__screenshots__/*/[mock-]*.mjs` precedent (two-page flows included).
Checkpoint 11-1 requires the Design Checkpoint Evidence treatment: every
new interactive control (Take over, retry, veiled editor) cites its
in-app exemplar (`ConfirmDialog` actions, save-error notice) or ships a
rendered mock. New icon ligatures (e.g. `lock`) must be added to the
self-hosted subset — `npm run icons:refresh`, staged with the feature
commit.

## 4. Implementation Plan

| Phase | Files | Work |
|-------|-------|------|
| **P1 — Lock core** (core-engine) | `core/services/session-lock.service.ts` (+spec), `workspace.service.ts` (attach/detach + gating + spec additions), `storage.service.ts` (scheduleSave fire-time gate + spec) | §3.1 + §3.2 + §3.4 + §3.5 |
| **Checkpoint 11-1** (user) | — | prompt + notice + veil evidence (rendered mocks, exemplar citations) + copy + prompt-frequency rule |
| **P2 — Shell surface** (ui-specialist) | `app.ts` (lock wiring effect), `topbar.html/.ts/.scss` (notice), `entry-editor` (veil) (+specs) | §3.3 |
| **P3 — Review** (ts-reviewer) | all touched | listener/channel/lock teardown, state-machine exhaustiveness (`switch` + `never` guards — the `runBarAction` precedent in `app.ts`), lint |
| **P4 — E2E & evidence** (qa-auditor) | `e2e/session-lock.spec.ts` | §3.6 + screenshots; fast gate = desktop-chrome smoke of this spec; the mobile-project pass (bottom-sheet prompt via `openResponsive`, veil on phone) rides the branch-final sweep |

Commits: `feat(session): per-project web-lock guard with non-destructive
takeover`, `feat(shell): takeover prompt, read-only notice and editor
veil`, `test(e2e): two-tab session lock and pagehide flush`, then
`docs(next_tasks): …`. Branch: `feature/11-multi-tab-session-lock` off
`develop`.

## 5. Orchestration

1. **`core-engine`** — P1 (skills: `typescript-advanced-types`,
   `angular-developer`). *Gate: `npm test` (full suite, coverage) +
   `npm run build`.*
2. **User checkpoint 11-1** — prompt/notice/veil mocks + copy. Gate stays
   open until answered; never close on a recommended default.
3. **`ui-specialist`** — P2 (skills: `material-3`, `frontend-design`).
   *Gate: `npm test` + `npm run build`.*
4. **`ts-reviewer`** — P3. *Gate: `npm run lint` + `npm run build`.*
5. **`qa-auditor`** — P4 (skills: `playwright-cli`). *Gate: fast-gate
   build + unit/coverage + lint + `typecheck:e2e` + desktop-chrome smoke
   of `session-lock.spec`; branch-final sweep runs the full three-project
   matrix per project (each command < ~8 min, report between).*

## 6. Verification Gates

`npm run build` · full `CI=true npm test -- --watch=false --coverage`
(thresholds enforced in-run) · `npm run typecheck:e2e` ·
`npx playwright test session-lock` (desktop-chrome in-task; full matrix at
branch-final) · `round-trip` still green as the unchanged-bytes confirmer
(single-tab behavior must not move) · `npm run lint` · screenshot
comparison in the phase report.

## 7. Risks & Open Questions

1. ~~Session vs per-project lock~~ — **decided: per-project** (§3.0.1).
2. **Hung holder**: no force path — `steal: true` exists in the spec but
   releases without the holder's cooperation (no flush ⇒ destructive) and
   has uneven support; excluded deliberately. The notice's retry re-posts
   the handshake; a hung tab keeps the lock until it dies, at which point
   the queued request or the re-probe picks it up.
3. **Boot/switch race**: writes are allowed in `acquiring` (a booting tab
   that is genuinely alone must not drop early keystrokes); the window is
   ms–tens of ms. If settle shows `blocked`, a slipped write is confined
   to memory (the scheduleSave gate blocks its save; gated keystrokes are
   non-actions and heal on the reload-on-acquire) — pinned by the
   "gated keystrokes heal" unit case.
4. **Release race**: writes are also gated in `relinquishing`, and the
   debounced save re-checks the gate when the timer *fires* — a save
   scheduled just before takeover can never land after `lost`.
5. **Two-page e2e flake**: both pages share one BrowserContext (therefore
   one lock space and one IndexedDB) — correct for this test, but sync on
   UI states (prompt visible, editor content), never `waitForTimeout`;
   `bringToFront()` for the visibilitychange re-probe;
   `page.close({ runBeforeUnload: true })` for the pagehide pin. Known
   pre-existing entry-editor flake under parallel load (archive README,
   task 08): report, don't paper over.
6. **Prompt frequency**: re-opening the same project into `blocked` in one
   session — prompt again vs notice-only — is checkpoint 11-1's call with
   the copy.
7. **jsdom**: `navigator.locks` is absent there; specs install fakes on
   `globalThis` (match-media-stub precedent) and never rely on jsdom's
   own `BroadcastChannel`, if present.
