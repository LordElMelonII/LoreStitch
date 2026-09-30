# Task 11 Progress Ledger

Plan: [11-multi-tab-session-lock.md](./11-multi-tab-session-lock.md) (re-anchored
2026-09-30, §3.0 decisions locked with the user; anchored at `6c5aec5`).
Branch: `feature/11-multi-tab-session-lock` (off `develop` @ `6c5aec5`).

## Step 0 — Plan re-anchor (orchestrator)

**Status**: ✅ complete — commit `7bc7b4f` `docs(next_tasks): re-anchor task 11 and lock design decisions`

## Phase P1 — Lock core (core-engine)

**Status**: ✅ complete — commit `aaa1ffc` `feat(session): per-project web-lock guard with non-destructive takeover`

**Landed**:
- NEW `src/app/core/services/session-lock.service.ts` — the §3.1 state machine
  (`idle|acquiring|held|blocked|relinquishing|lost`), `canEdit` (held|acquiring),
  `blockedAttempt` pulse, `attach/detach/takeover`, `lorestitch-project:<id>`
  Web Locks with hold-for-tab-lifetime grants, one
  `BroadcastChannel('lorestitch-project-lock')` handshake (per-message
  projectId filtering), flush-before-release ordering, re-probe on
  visibilitychange/focus + 30 s timer, `pagehide`/hidden best-effort flush,
  absent-APIs ⇒ `held` degradation, pending-request promises marked handled
  up front (the storage.service rejection lesson).
- NEW `src/testing/session-lock-fakes.ts` — fake LockManager (grant/taken/
  queue-FIFO + `holdFromOutside`) and fake BroadcastChannel harness;
  registered in `src/testing/README.md`.
- `workspace.service.ts` — attach on `setActive` (flush hook =
  `flushPendingSave`), detach on close/delete/switch, write gate
  (`mutateProject`/`commit`/`rollbackTo`/`deleteProject`); create/
  start-from-book/import paths, `openEntry` bookkeeping and `LAST_PROJECT_KEY`
  stay ungated per §3.2.
- `storage.service.ts` — `scheduleSave` fire-time gate (§3.2 defense in
  depth); `saveProject`/`flush` stay write-through for the relinquishing
  holder.
- Specs: `session-lock.service.spec.ts` (18), `workspace.service.spec.ts`
  (+8), `storage.service.spec.ts` (+3) — the full §3.6 unit matrix rows 1–2
  including the flush-before-release order pin and the §7.3
  acquiring-window-slip case.

**Gates**: full suite 64 files / 1477 tests, coverage 95.99/90.61/91.66/96.99
(thresholds green) · build green · lint green · typecheck:e2e green ·
desktop-chrome round-trip (4 passed) + character-card (5 passed) smokes —
single-tab behavior unmoved.

**Decisions/deviations** (core-engine, accepted):
1. **`writeEpoch` signal + epoch-pinned save tickets + `getProject` taint
   retirement** — beyond §3.2's literal fire-time check; closes (a) a slipped
   acquiring-window write landing after re-acquisition (would clobber the
   holder's flushed edits) and (b) the stale-`pendingProjects`-snapshot trap
   on the reload-on-acquire read path.
2. **`idle` treated as ungated** (`state === 'idle' || canEdit()`): 105
   pre-existing component specs seed `activeProject.set` directly and never
   attach; the lock only speaks for a project that went through `setActive`.
3. **`takeover()` resolution semantics**: resolves on grant or settle; stays
   pending against a live hung holder (§7.2), documented on the method.
4. **Flag (not acted on in P1)**: `openImportedWorkspace` keeps the archive's
   project id — §3.2's "fresh id" assumption is wrong for archives. Escalated
   to checkpoint 11-1 (see below; resolved in P1b).

**P1 contract for later phases** (recorded by core-engine): reload-on-acquire
must call `workspace.openProject(activeProject().id)` and nothing else —
same-id `setActive` skips lock churn, and P1's taint retirement makes
`getProject` serve storage truth.

## Checkpoint 11-1 — Session-lock UI evidence (user gate)

**Status**: ✅ answered 2026-09-30.

Evidence: rendered mocks driving the REAL app into the REAL two-tab blocked
state (`__screenshots__/11-session-lock/mock-*.mjs` + 7 PNGs; the
`ConfirmDialog` re-skinned in place, transplanted topbar chrome, injected
veil, re-labeled real snackbar). Behavioral proof captured in the same run:
the blocked tab's "New entry" click no-ops (gate live, 3→3 rows) while the
holder's adds (3→4) and survives its reload — the flush path works in a real
browser. Every new control cited its in-app exemplar (ConfirmDialog,
save-error marker, project-badge pill).

**User decisions**:
1. Prompt: approved copy + **dialog-only, full-screen on phones** (ConfirmDialog
   exemplar behavior) — title "Project open in another tab", body naming the
   project and promising the other tab's work is saved first, actions
   **Take over** / **Stay read-only**.
2. Prompt frequency: **prompt on every fresh open** into `blocked` (once per
   streak; re-probes and `lost` never prompt).
3. Read-only surfaces: **pill notice** ("Read-only" + lock, project-badge
   styling, click = takeover retry, universal across breakpoints) **+ veil
   with Take over** over the entry editor. A follow-up question about veiling
   the side drawers as well was retracted by the user ("option 1 like it
   is") — the veil covers the entry editor only; every other gated write
   (history commit/rollback, batch ops, drag, topbar buttons) stays covered
   by the write gate + snackbar.
4. Import gap (P1's flag): **gate it** — importing a `.stproj` whose project
   id another tab holds is refused (P1b below).

## Phase P1b — Locked-id archive import gate (core-engine addendum)

**Status**: ✅ complete — commit `df4cea2` `feat(session): refuse archive imports of projects held elsewhere`

**Landed**: `SessionLockService.isHeldElsewhere(projectId)` point probe
(ifAvailable, release-immediately, absent-API ⇒ false, rejecting probe ⇒
true = abort); `openImportedWorkspace` probes before persisting — a held id
aborts with one `blockedAttempt` pulse (the shared read-only chokepoint),
free/self-held/absent-API imports proceed as before. Specs: 5 service cases
+ 4 workspace cases (held ⇒ no save + one pulse; free ⇒ imports + acquires;
self-held re-import proceeds; absent API proceeds).

**Dispatch incident**: the subagent dispatch died on a provider
quota limit ("exceed quota limit") ~6.7 min in, having written the complete
implementation + specs but not verified/committed. Per the AGENTS.md
cancelled-subagent rule the orchestrator audited the partial work (found it
complete), ran the gates (1496 tests + coverage, build, lint, typecheck:e2e
— all green) and committed it.

## Phase P2 — Shell surface (ui-specialist)

**Status**: ✅ complete — commit `5b0860b` `feat(shell): takeover prompt, read-only notice and editor veil`

**Dispatch incident**: the ui-specialist dispatch died at spawn on the same
provider quota limit. The orchestrator implemented P2 directly (full context
held: the approved mocks, P1 contracts, both persona guides read).

**Landed**:
- `ConfirmDialogData.cancelLabel?` (default "Cancel") — the shared exemplar
  stays backward compatible; spec case added.
- `app.ts` wiring: transition effect (prompt on every fresh `blocked` entry
  with a project active; reload via `workspace.openProject(project.id)` when
  `held` is entered from `blocked`/`lost` — takeover grant and re-probe
  alike), blockedAttempt effect → snackbar "Read-only — this project is held
  by another tab" (OK, 3 s, the app's snackbar convention), prompt opened
  through `ResponsiveOverlayService.openResponsive` dialog-only with
  `app-compact-fullscreen-dialog`, guarded against double-open, confirm ⇒
  `takeover()`.
- `topbar` — `.read-only-pill` (40 px target, lock ligature, project-badge
  styling family) `@if`-rendered while `blocked`/`lost` (removed from the
  DOM while editable, phones included per the save-error rule).
- `entry-editor` — `.session-veil` over the pane while
  blocked/lost/relinquishing (never `acquiring` — a booting tab must not
  flash), editor content `[attr.inert]` (keyboard AND pointer; jsdom does
  not reflect the `inert` IDL property, so the attribute binding is
  explicit), Take over button offered in blocked/lost only.
- `lock` ligature joined the self-hosted subset (`icons:refresh`; font
  staged with the commit).
- Specs: app.spec wiring describe (prompt copy, confirm/dismiss/fresh-open
  streak rule, reload-on-acquire incl. the plain-acquire control,
  snackbar-per-pulse), topbar.spec pill cases (blocked/lost/held, mobile
  band, retry click), entry-editor.spec veil cases (veil + inert + aria,
  relinquishing hides the button, acquiring/held/idle unveiled),
  confirm-dialog cancelLabel case. 10 net-new tests.

**Gates**: 64 files / 1496 tests + coverage green · build green · lint green
· typecheck:e2e green · desktop-chrome round-trip + character-card smokes
(9 passed).

## Phase P3 — Review (ts-reviewer)

**Status**: ✅ complete — commit `bbfbe43` `refactor(session): tighten lock teardown, typing and exhaustiveness`

**Fixed**: never-guard exhaustiveness on `sessionVeiled`/`sessionCanRetry`
switches (the `runBarAction` precedent — a future `SessionLockState` member
now fails loudly instead of silently reading as editable); redundant alias
removed from the shell transition effect.

**Audited clean**: teardown (listeners/timers/channel on every detach path,
idempotent release, safe mid-probe detach), flush-before-release ordering on
detach and relinquish, IndexedDB put-before-delete ordering on deleteProject,
one-shot `afterClosed`, `instanceof MatDialogRef` narrowing per the
`openResponsive` contract, no `any`/non-null assertions, computed purity, no
self-reading effect writes. Observations left as-is (documented in the
phase report): the `getProject` catch branch's unconditional pending-snapshot
serve on a degraded path; the lazy-import window in `openLockPrompt`;
ungated non-active-project delete.

**Gates**: 1496 tests + coverage · build · lint (agent) + typecheck:e2e +
desktop-chrome round-trip smoke (orchestrator) — green.

## Phase P4 — E2E & evidence (qa-auditor)

**Status**: ✅ complete — commit `c8779f4` `test(e2e): two-tab session lock and pagehide flush`

**Spec** (`e2e/session-lock.spec.ts`, all four §3.6 cases, two pages one
context, UI-state sync only, `EDIT_COMMIT_FLUSH_MS` pacing):
1. Non-destructive pin — B's Take over lands A's typed edit in B's editor
   (flush-before-release proven end-to-end) + A gets pill/veil/inert; B edits
   on its own lock.
2. Two projects — B boots blocked (designed 3.0.4 behavior), dismisses,
   creates a fresh project: no prompt, no pill, both tabs editable.
3. Stale holder — B's gated click snacks the read-only copy; A dies without
   the handshake; B's re-probe clears pill/veil, editing resumes, A's saved
   edit is visible.
4. Pagehide flush — a close inside the save debounce lands the edit for a
   fresh tab.

**Environment findings (documented in-spec)**: the headless shell never
transitions `visibilityState` (every page permanently visible+focused), and
`page.close({ runBeforeUnload: true })` leaves a zombie Web Locks holder for
seconds. The spec therefore closes plainly (real "tab destroyed" semantics)
and dispatches the app's REAL registered `focus`/`pagehide` listeners — all
product paths stay exercised; only the browser's event generation is
simulated.

**After-side visual baseline**: `__screenshots__/11-session-lock/capture.mjs`
(task-19 pinned protocol, desktop 1280×800 + phone 390×844, light theme):
`after/01…05` — prompt, snackbar+veil, pill+veil (desktop + phone), phone
full-screen prompt. Before side: no UI existed to capture — the silent
last-writer-wins second tab is the before (task-19 report-the-before
precedent); the checkpoint mocks stand between.

**Gates**: fast gate (build, 1496 + coverage 95.97/90.64/91.75/96.96, lint,
typecheck:e2e, desktop-chrome session-lock 4 passed ×2). **Branch-final
sweep**: desktop-chrome 91 passed/20 skipped (4.4 m) · mobile-chrome 54
passed/57 skipped (3.4 m) · mobile-safari 52 passed/59 skipped (5.1 m) —
session-lock ran on all three (phone passes exercised the bottom-bar branch
and phone-width dialog/veil/pill); final suite + coverage and lint green.

## Outcome

Branch `feature/11-multi-tab-session-lock` complete and pushed; awaiting the
user's manual test. **Not merged** — `git merge --ff-only` into `develop`
only after the user's explicit go per the task-branch rule.
