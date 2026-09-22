# Task 11 — Multi-Tab Session Lock

> **Source**: ROADMAP.md (LOW PRIORITY) — *"Avoids IndexedDB overwrites across
> simultaneous browser tabs without over-engineering multi-device conflict
> resolvers."* Web Locks API (`navigator.locks`) or `BroadcastChannel` heartbeat
> showing a non-destructive "Session open in another tab" takeover prompt.
> **Type**: Data-loss guard (concurrency), small UI surface
> **Suggested agents**: `core-engine` (lead: lock service + write gating) →
> `ui-specialist` (takeover prompt + notice) → `ts-reviewer` → `qa-auditor`
> **Status**: 🟡 Planned — not started

---

## 1. Objective

At most one tab per browser profile edits a workspace at a time. A second tab
that opens the studio while another holds the session sees a non-destructive
takeover prompt — **taking over flushes the losing tab's pending save first,
so no edit is ever discarded** — and the losing tab degrades to a read-only
notice instead of silently clobbering. The multi-device conflict resolvers the
roadmap explicitly rejects stay out of scope.

## 2. Gap analysis (develop @ `ddc9f04`)

Two tabs = silent last-writer-wins on the whole `ProjectWorkspace` record:

- Every mutation ends in `mutateProject` → `storage.scheduleSave(next)`
  (`workspace.service.ts:436-444`), which debounces ~400ms and then
  `put`s the **entire project object** (`storage.service.ts:84-100,
  121-137`). Two tabs holding divergent in-memory copies of the same project
  interleave whole-record puts: the slower tab's write erases the faster
  tab's edits with no error anywhere.
- `WorkspaceService.init` auto-reopens the most recent project in **every**
  tab (`workspace.service.ts:93-103`, `LAST_PROJECT_KEY`) — so the collision
  is the default two-tab experience, not an edge case.
- `StorageService.getProject` prefers the in-memory `pendingProjects`
  snapshot (`storage.service.ts:74-82`) — correct in-tab, invisible cross-tab:
  the other tab's newer write is never noticed.
- Nothing in `src/` uses `navigator.locks`, `BroadcastChannel`, or cross-tab
  signaling (grep: 0 hits) — this is greenfield.

The pre-existing save-state affordance (topbar icon + tooltip for
`workspace.saveError`, `topbar.html:36-41`) covers persistence *failure*;
this task covers persistence *racing*, which today fails silently and only
surfaces as "my edit vanished" after a reload.

## 3. Design

### 3.1 Lock service — `core/services/session-lock.service.ts`

`@Service()` in core (house naming; UI-framework-free like `StorageService` —
platform APIs are fine in core, Angular UI is not). Owns the exclusive lock
named `lorestitch-session` and a tiny `BroadcastChannel('lorestitch-session')`
for the takeover handshake:

```ts
export type SessionLockState =
  | 'acquiring'   // boot, probe in flight — writes allowed (see §7.3)
  | 'held'        // this tab owns the session
  | 'blocked'     // another tab owns it; takeover prompt territory
  | 'relinquishing' // takeover requested; flushing + releasing
  | 'lost'        // we gave the session away (or it was taken); read-only

@Service()
export class SessionLockService {
  readonly state = signal<SessionLockState>('acquiring');
  /** Registered by the shell: runs (awaits) before the lock is released. */
  readonly beforeRelinquish = signal<(() => Promise<void>) | null>(null);
  /** Resolve once, when `state` is terminal-ish (`held`/`blocked`/`lost`). */
  readonly settled: Promise<void>;
  /** From `blocked`: ask the holder to relinquish, then take the session. */
  takeover(): Promise<void>;
}
```

Mechanics (Web Locks primary):

- **Hold**: `navigator.locks.request('lorestitch-session', { mode: 'exclusive' },
  grant)` where the `grant` callback resolves a held promise only at release —
  the standard "hold the lock for the tab's lifetime" pattern. If the request
  grants immediately ⇒ `held`; with `{ ifAvailable: true }` a fast probe sets
  `blocked` without queueing, then `takeover()` queues a real request.
  The db-rejection lesson from `storage.service.ts:38-45` applies: mark the
  pending request handled up front so Node/jsdom never reports an unhandled
  rejection.
- **Takeover handshake** (non-destructive is the whole point): `takeover()`
  posts `takeover-request` on the channel → the holder runs
  `beforeRelinquish()` (the shell registers `workspace.flushPendingSave`,
  `workspace.service.ts:451`) **before** releasing the lock, posts
  `relinquished`, and enters `lost`; the requester's queued lock request then
  grants ⇒ `held`, and the shell reloads the project from storage (§3.3).
  A holder that never answers (hung tab) leaves the requester `blocked` with
  the prompt's retry affordance — Web Locks has no steal, and faking one is
  exactly the over-engineering the roadmap rejects.
- **Fallback** (no `navigator.locks`: jsdom, Safari < 15.4): the same
  handshake over `BroadcastChannel` heartbeats (holder posts every 2s; a tab
  seeing silence for 5s claims the session and announces it). With
  **both** APIs absent (bare jsdom in unit tests), the service degrades to
  `held` — single-tab assumption, no test suite ever blocks on it.

### 3.2 Write gating — the `mutateProject` chokepoint

Per the workspace-mutation invariant all writes already funnel through
`mutateProject` (`workspace.service.ts:436`). When `state()` is `blocked` or
`lost`, it early-returns: a read-only tab cannot build a divergent tree that
would clobber the real one on a later takeover. `StorageService.scheduleSave`
gains the same gate as defense in depth (it is the last door to the record).
Tab/book-keeping that is not a project mutation (`openEntry`, `activeTabId`)
stays live — browsing in the read-only tab is harmless.

### 3.3 Shell surface — `app.ts` (+ `topbar.html` notice)

- **Takeover prompt** on the first `blocked` state: the `ConfirmDialog`
  exemplar (`shared/components/confirm-dialog/confirm-dialog.ts`, the
  delete-confirm's data-driven shape) opened through
  `ResponsiveOverlayService.openResponsive` (dual-container invariant — the
  dialog-vs-bottom-sheet branch never appears at a call site). Copy sketch for
  checkpoint 11-1: title "Session open in another tab", body explaining the
  other tab keeps its edits and this one can take over safely, actions
  **Take over** (primary) and **Stay read-only** (dismiss).
- **Read-only notice** while `blocked` (after dismiss) or `lost`: the save-
  error topbar icon precedent (`topbar.html:36-41`) — icon + tooltip +
  `aria-label`, with a "Take over" retry action (for `blocked`) reachable from
  it. Final chrome at checkpoint 11-1 (rendered mock — new interactive
  control ⇒ design-evidence gate).
- **Reload on acquire**: when `takeover()` lands on `held`, the shell calls
  `workspace.openProject(activeProject().id)` so the tab's tree and forms
  re-derive from the flushed storage state (any gated keystrokes in the
  read-only window are non-actions and heal — `entrySliceSignal` re-seeds its
  form slice on entry replacement, `entry-edit-form.ts:33-38`).

### 3.6 Test matrix

| Tier | Required cases |
|------|----------------|
| Unit — `session-lock.service.spec.ts` | fake `navigator.locks` + fake `BroadcastChannel` harnesses: probe ⇒ `held` on free, `blocked` on taken; takeover runs `beforeRelinquish` **before** release (order pin); `relinquished` message then grant ⇒ `held`; hung holder ⇒ stays `blocked`; heartbeat fallback claims after silence; both-APIs-absent ⇒ `held` |
| Unit — write gating | `mutateProject` no-ops in `blocked`/`lost` (entries unchanged, `scheduleSave` not called); `openEntry` still works |
| Unit — shell | prompt opens once per `blocked` streak; Take over ⇒ `takeover()` + `openProject` reload; dismiss ⇒ notice with retry |
| E2E — new `e2e/session-lock.spec.ts` (two pages, one context) | page A imports the seeded project and types into an entry; page B (`context.newPage()`) shows the takeover prompt; B clicks **Take over** ⇒ A shows the lost/read-only notice **and** B's editor shows A's typed edit (the flush-before-release proof — the non-destructive pin); B's editing works afterwards; one mobile-project pass (prompt as bottom sheet via `openResponsive`) |

**Visual gate**: the prompt + notice are new UI ⇒ before/after screenshots
under `__screenshots__/11-session-lock/{before,after}/` (pinned conditions per
the baseline protocol — before = the silent-clobber status quo / after =
prompt + notice) posted with the phase report. Checkpoint 11-1 requires the
Design Checkpoint Evidence treatment: every new interactive control (Take over,
retry) cites its in-app exemplar (`ConfirmDialog` actions) or ships a rendered
mock — the `__screenshots__/*/[mock-]*.mjs` real-app-driving precedent.

## 4. Implementation Plan

| Phase | Files | Work |
|-------|-------|------|
| **P1 — Lock core** (core-engine) | `core/services/session-lock.service.ts` (+spec), `workspace.service.ts` (gating), `storage.service.ts` (gating) | §3.1 + §3.2 |
| **Checkpoint 11-1** (user) | — | prompt + notice evidence (rendered mock, exemplar citations) + copy |
| **P2 — Shell surface** (ui-specialist) | `app.ts`, `topbar.html/.ts/.scss` | §3.3 |
| **P3 — Review** (ts-reviewer) | all touched | listener/lock teardown via `DestroyRef`, state-machine exhaustiveness (switch `never` guards — the Task 06 P3 precedent), lint |
| **P4 — E2E & evidence** (qa-auditor) | `e2e/session-lock.spec.ts` | §3.6 + screenshots |

Commits: `feat(session): multi-tab session lock with takeover`, `feat(shell):`
prompt/notice if it lands separately, `test(e2e): …`, `docs(next_tasks): …`.

## 5. Orchestration

1. **`core-engine`** — P1 (skills: `typescript-advanced-types`,
   `angular-developer`). *Gate: `npm test`.*
2. **User checkpoint 11-1** — prompt/notice mock + copy. Gate stays open
   until answered.
3. **`ui-specialist`** — P2 (skills: `material-3`, `frontend-design`).
   *Gate: `npm test` + `npm run build`.*
4. **`ts-reviewer`** — P3. *Gate: `npm run lint`.*
5. **`qa-auditor`** — P4 (skills: `playwright-cli`). *Gate: `npx playwright
   test session-lock` green on desktop-chrome + one mobile project, run per
   project per the long-gate rule.*

## 6. Verification Gates

`npm run build` · `npm test` · `ng test --coverage` (lock service + gating
covered) · `npx playwright test session-lock round-trip` (round-trip as the
unchanged-bytes confirmer) · `npm run lint` · screenshot comparison in the
phase report.

## 7. Risks & Open Questions

1. **Session-level vs per-project lock**: the roadmap's copy ("Session open in
   another tab") reads session-level, and this plan scopes one lock to the
   whole studio — simpler and also guards `appState`/`savedProjects` writes.
   The alternative (lock name `lorestitch-project:<id>`) lets two tabs edit
   *different* projects concurrently; strictly nicer for power users, a bit
   more state (per-project acquire/release on open/close/switch). Checkpoint
   11-1 can flip this cheaply while P1 is being written — decide first.
2. **Hung holder**: no steal in Web Locks. The prompt's retry re-posts
   `takeover-request`; a truly hung tab keeps the lock until it dies. A
   force path (heartbeat-based mutual claim in fallback mode only) is
   deliberately excluded.
3. **Boot race**: writes are allowed in `acquiring` (a booting tab that is
   genuinely alone must not drop early keystrokes); the window closes at lock
   settle (ms–tens of ms). If settle shows `blocked`, any write that slipped
   through is confined to memory (gating blocks its save) and heals on
   takeover reload (§3.3) — pinned by the "gated keystrokes are non-actions"
   unit case.
4. **Two-page e2e flake**: both pages share one BrowserContext (and therefore
   the lock space) — correct for this test, but the pages must not race the
   dev server boot; use the prompt visibility as the sync point, never
   `waitForTimeout`. The known pre-existing entry-editor `whenStable` flake
   (archive README, task 08) may still appear under parallel load — report,
   don't paper over.
5. **`pagehide` flush** (flush pending saves on tab close) is a cheap
   resilience add-on riding the same `beforeRelinquish` hook; optional
   stretch in P1, not required for the gate.
