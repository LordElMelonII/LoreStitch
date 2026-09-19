# core/services/

UI-framework-free services: `workspace.service` (project state chokepoint → immutable replace → debounced IndexedDB save), `storage.service` (IndexedDB via `idb`), `vcs.service` (SHA-256 content-addressed commits), `import-export.service` (3 import formats, 4 export flavors), `theme.service`, plus pure analysis modules `sha256.ts`, `token-estimator.ts`, `linter.ts`.

**Hints**

- Naming: injectable classes get `.service.ts` + `@Service()`; pure framework-free analysis code keeps a bare name even under `core/services/` (`sha256.ts`, `token-estimator.ts`, `linter.ts` precedent).
- Features never call `activeProject.set` — only the narrow typed mutators on `WorkspaceService` (a direct write skips persistence).
- `sha256.ts` exists because `crypto.subtle` is absent on plain-http LAN origins; keep commit ids byte-identical across environments.
