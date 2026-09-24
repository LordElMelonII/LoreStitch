# core/services/

UI-framework-free services: `workspace.service` (project state chokepoint → immutable replace → debounced IndexedDB save), `storage.service` (IndexedDB via `idb`), `vcs.service` (SHA-256 content-addressed commits), `import-export.service` (5 import formats, 6 export flavors), `theme.service`, plus pure analysis modules `sha256.ts`, `token-estimator.ts`, `linter.ts`.

**Hints**

- Naming: injectable classes get `.service.ts` + `@Service()`; pure framework-free analysis code keeps a bare name even under `core/services/` (`sha256.ts`, `token-estimator.ts`, `linter.ts` precedent).
- Features never call `activeProject.set` — only the narrow typed mutators on `WorkspaceService` (a direct write skips persistence).
- `sha256.ts` exists because `crypto.subtle` is absent on plain-http LAN origins; keep commit ids byte-identical across environments.
- `vcs.service` memoizes canonical serializations by object identity — correct only under the immutable-update invariant (model objects are never mutated in place); an in-place mutation after a serialize would read a stale string.
- `linter.ts` hoists per-target key parsing/folding and per-source case folding out of its O(V²) recursion pair loop (`prepareTargetKeys`); verdicts are unchanged — see `firstMatchingKey`'s equivalence notes.
