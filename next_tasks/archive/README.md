# Archive — Completed Task Plans

Plans for finished tasks, moved out of the active folder on 2026-09-20 so
`next_tasks/` holds only pending work. They remain the authoritative record of
each task's design decisions, phase breakdowns, and landing history.

| # | Plan | Completed | Landed | Notes |
|---|------|-----------|--------|-------|
| 01 | [delimiters-edge-cases.md](./01-delimiters-edge-cases.md) | 2026-09-18 | `a5f4c34`..`109061d` | P1 model hardening, P2 dialog previews/token deltas, P3 E2E suite; §7.2 open question resolved in `d99e5eb` |
| 02 | [mobile-ergonomics.md](./02-mobile-ergonomics.md) | 2026-09-18 | — | Established the reusable dialog→bottom-sheet conversion pattern (prerequisite for 03's linter sheet) |
| 05 | [urgent-mismatched-delimiters.md](./05-urgent-mismatched-delimiters.md) | 2026-09-19 | `ba8b753`..`ca41d39` | Mismatched/malformed delimiter detection & cleanup; template for the urgent-intake convention |
| 03 | [lorebook-linter.md](./03-lorebook-linter.md) | 2026-09-19 | `552a6cc`..`37865dc` | Design recorded in plan §3.6 (user-approved, incl. the ignore/mute `.stproj` amendment); Phase 1 shared `st-regex`/`st-key-match` modules that Task 04 consumes; adopted 05's `detectMalformedWrapper` as a lint rule |
| 04 | [regex-key-sandbox.md](./04-regex-key-sandbox.md) | 2026-09-20 | `4bb1d5b`..`14dae49`, ff-merged to `develop` 2026-09-20 after user test | Chip regex classification + inline "Test keys" playground; design recorded in plan §3.6 (gate closed on the recommended default — visuals re-reviewable via `__screenshots__/04-regex-sandbox/comparison.html`); §8.6 linter-copy premise resolved as stale (landed copy already accurate) |

Grounding SHAs of the original audits: 01/02 at `4120bb9`, 03 re-grounded
at `329509b`, 04 re-grounded at `af244ba` (plan HEAD `1955a9e`), 05 at `c003bce`.
