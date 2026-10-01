# features/shell/

Application shell: topbar (`topbar/` — project switcher, token meter + `token-inspector-dialog`, linter shield with count badge, read-only session pill, menus; the focus-mode toggle moved beside the entry's content field in v1.8.0), `welcome-screen/` (empty state, recent projects), `mobile-bottom-bar/` (phone action bar, always docked — open drawers veil it via its `barState` input, an active selection in the entries drawer swaps it to the batch actions, routed through `App.runBatchBarAction` to the `EntryList` public API), `new-project-dialog.ts`, and `project-actions.service.ts` (shared import/export/merge flows, opens the responsive overlays). The session lock's editor veil over `[attr.inert]`ed content (another tab holds the project) lives in `entry-editor/` and reads `SessionLockService` directly — state-driven, no shell wiring.

**Hints**

- New topbar entries should degrade into the More-actions overflow menu on phones — the health-check button is the exemplar.
