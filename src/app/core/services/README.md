# core/services/

UI-framework-free services: `workspace.service` (project state chokepoint → immutable replace → debounced IndexedDB save), `storage.service` (IndexedDB via `idb`), `vcs.service` (SHA-256 content-addressed commits), `import-export.service` (5 import formats, 6 export flavors), `theme.service`, `session-lock.service` (per-project Web Lock + BroadcastChannel handshake — one tab holds a project, non-destructive takeover, flush-before-release), plus pure analysis modules `sha256.ts`, `token-estimator.ts`, `linter.ts`, `entry-memo.ts`.

**Hints**

- Naming: injectable classes get `.service.ts` + `@Service()`; pure framework-free analysis code keeps a bare name even under `core/services/` (`sha256.ts`, `token-estimator.ts`, `linter.ts`, `entry-memo.ts` precedent).
- Features never call `activeProject.set` — only the narrow typed mutators on `WorkspaceService` (a direct write skips persistence).
- `sha256.ts` exists because `crypto.subtle` is absent on plain-http LAN origins; keep commit ids byte-identical across environments.
- `vcs.service` memoizes canonical serializations by object identity — correct only under the immutable-update invariant (model objects are never mutated in place); an in-place mutation after a serialize would read a stale string.
- `linter.ts` runs one resumable engine (`createLintPass`): `lintBook` is it run synchronously to completion (pinned public API) and the health pane drives the same engine chunk-by-chunk, so the output is byte-identical at any chunk cadence. Per-target key plans and per-pair recursion verdicts are memoized by entry identity (plan 19 D2) — the same identity-keyed contract as `vcs.service`'s memos: correct only under the immutable-update invariant, no invalidate API. Verdict equivalence notes: see `firstMatchingKey`.
