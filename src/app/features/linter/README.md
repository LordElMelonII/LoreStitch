# features/linter/

Health-check UI (v1.2.0): `linter-dialog.ts` (dual-container pane: findings grouped by severity, mute chips, per-issue ignore, jump-to-entry buttons) and `linter-state.ts` (the `@Service()` wrapper holding scan results + mute/ignore prefs, persisted in the `.stproj` archive via `WorkspaceService`).

**Hints**

- Detection rules live in `core/services/linter.ts` (pure module) — keep the dialog presentational.
- Extreme-state trap to keep covered: muting every rule once blanked the pane including the mute chips — the recovery path needs a test (see Task 03).
