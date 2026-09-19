# src/app/

The Angular application in three layers:

- `core/` — framework-free domain: lorebook models, SillyTavern semantics, persistence, VCS, import/export.
- `features/` — user-facing surfaces (shell, editor, dialogs), one folder per feature.
- `shared/` — cross-feature components, directives, constants, and UI-coupled services.

`app.ts` mounts the shell (topbar, drawers, mobile bottom bar); `app.config.ts` provides the service worker, Material defaults, and the icon-font sanitizer. State is Signals-only (see `AGENTS.md`).

**Hints**

- Dual-container panes open only via `ResponsiveOverlayService.openResponsive` — viewport branching never appears at call sites.
