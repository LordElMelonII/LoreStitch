# Archive — Completed Task Plans

Plans for finished tasks, moved out of the active folder (first on 2026-09-20) so
`next_tasks/` holds only pending work. They remain the authoritative record of
each task's design decisions, phase breakdowns, and landing history.

| # | Plan | Completed | Landed | Notes |
|---|------|-----------|--------|-------|
| 01 | [delimiters-edge-cases.md](./01-delimiters-edge-cases.md) | 2026-09-18 | `a5f4c34`..`109061d` | P1 model hardening, P2 dialog previews/token deltas, P3 E2E suite; §7.2 open question resolved in `d99e5eb` |
| 02 | [mobile-ergonomics.md](./02-mobile-ergonomics.md) | 2026-09-18 | — | Established the reusable dialog→bottom-sheet conversion pattern (prerequisite for 03's linter sheet) |
| 05 | [urgent-mismatched-delimiters.md](./05-urgent-mismatched-delimiters.md) | 2026-09-19 | `ba8b753`..`ca41d39` | Mismatched/malformed delimiter detection & cleanup; template for the urgent-intake convention |
| 03 | [lorebook-linter.md](./03-lorebook-linter.md) | 2026-09-19 | `552a6cc`..`37865dc` | Design recorded in plan §3.6 (user-approved, incl. the ignore/mute `.stproj` amendment); Phase 1 shared `st-regex`/`st-key-match` modules that Task 04 consumes; adopted 05's `detectMalformedWrapper` as a lint rule |
| 04 | [regex-key-sandbox.md](./04-regex-key-sandbox.md) | 2026-09-20 | `4bb1d5b`..`14dae49`, ff-merged to `develop` 2026-09-20 after user test | Chip regex classification + inline "Test keys" playground; design recorded in plan §3.6 (gate closed on the recommended default — visuals re-reviewable via `__screenshots__/04-regex-sandbox/comparison.html`); §8.6 linter-copy premise resolved as stale (landed copy already accurate) |
| 07 | [search-responsiveness.md](./07-search-responsiveness.md) | 2026-09-20 | `8d32256`..`0b7f9a4`, ff-merged to `develop` 2026-09-21 after user go-ahead | `debouncedSignal` primitive + haystack pre-fold + debounced S&R preview (results byte-identical); §3.3 single-pass stretch REJECTED by review (GetSubstitution reimplementation risks silent corruption); perf trace 2421ms→71ms blocked @4× throttle; P3 fixed the append-reveal flush no-op |
| 06 | [mobile-bottom-bar-docked-swap.md](./06-mobile-bottom-bar-docked-swap.md) | 2026-09-21 | `f15b2f6`..`f9b4615` on `feature/06-mobile-bar-docked-swap`, ff-merged to `develop` 2026-09-21 (`1041a45`) | Always-docked bar + `barState` (normal/backgrounded/batch) + phone pane-focus policy; batch swap transplant (design gate 06-1 closed on A2 — tonal top edge); P3 added switch-exhaustiveness guards + cancelled-delete recovery guard. Open follow-up: batch-APPLY focus handoff outside §3.2's recovery contract. Screenshots `__screenshots__/06-mobile-bar-swap/` |
| 08 | [test-keys-trigger-verdict.md](./08-test-keys-trigger-verdict.md) | 2026-09-21 | `1df3007`..`7fee7c5` on `feature/08-test-keys-trigger-verdict`, ff-merged to `develop` 2026-09-21 (`994a696`) | Pure `st-trigger` verdict module mirroring the vendored `world-info.js` (47 truth-table tests incl. the user-report NOT-Any repro) + panel verdict banner; design gate 08-1 closed on treatment 1 ("(blocks activation)" suffix); probabilistic branch pinned e2e via the real `Probability %` field. Known pre-existing flake: entry-editor 5s `whenStable` under parallel load. Screenshots `__screenshots__/08-test-keys-verdict/` |
| 15 | [character-card-round-trip.md](./15-character-card-round-trip.md) | 2026-09-23 | `94f9148`..`2c2b7f0` | Character-card round-trip: bare `core/models/character-card.ts` (PNG chunk codec, CRC-checked `tEXt` `chara`/`ccv3`), card PNG/JSON import through the same pipeline as plain books, card export flavors with the approved per-reason refusal copy (checkpoint 15-1), e2e `character-card.spec.ts`; shipped as v1.5.0 |

Grounding SHAs of the original audits: 01/02 at `4120bb9`, 03 re-grounded
at `329509b`, 04 re-grounded at `af244ba` (plan HEAD `1955a9e`), 05 at `c003bce`;
06 re-grounded at `aabdb3c`, 07 at `c05592a`, 08 at `ba67c85` (2026-09-20/21,
no reference drift found in any).
