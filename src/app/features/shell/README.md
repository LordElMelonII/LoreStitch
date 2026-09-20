# features/shell/

Application shell: topbar (`topbar/` — project switcher, token meter + `token-inspector-dialog`, linter shield with count badge, focus-mode toggle, menus), `welcome-screen/` (empty state, recent projects), `mobile-bottom-bar/` (phone action bar, always docked — open drawers veil it via its `barState` input), `new-project-dialog.ts`, and `project-actions.service.ts` (shared import/export/merge flows, opens the responsive overlays).

**Hints**

- New topbar entries should degrade into the More-actions overflow menu on phones — the health-check button is the exemplar.
