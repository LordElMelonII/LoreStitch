# Task 17 — Progress Ledger

Plan: [17-known-reds.md](./17-known-reds.md). Branch: `feature/17-known-reds`
(off `develop` @ `177df06`). Checkpoint 17-0 answered 2026-09-27 (user approved
the cap path for Red B: "Ok, let's solve them").

## Phase 0 — planning

**Status**: ✅ complete

- Branch created; plan + this ledger committed
  (`docs(next_tasks): plan task 17 ...`).
- Verified at HEAD: Red A assertion still stale (spec line 402); Red B still
  repros per the task-16 sweep artifacts (`test-results/…mobile-safari*`,
  `Expected: <= 601 / Received: 638.504`, both try and retry).
- Material panel ships `overflow: auto` (cap ⇒ internal scroll, no extra
  rule); topbar 56px; shell sizes with `100dvh`; no other spec pins the
  count/menu geometry (unit `mobile-bottom-bar.spec.ts:296` pins the mobile
  strip's visible label — still valid).

**Next**: before-captures, then P1 dispatch.
