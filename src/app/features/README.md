# features/

One folder per user-facing surface; all standalone components with Signals state. Dialog-style features (`entry-list` batch, `linter`, `merge-resolver`, `about`) host dual-container panes — dialog on tablet/desktop, bottom sheet on phones — opened via `ResponsiveOverlayService.openResponsive`; `delimiters` and `search-replace` are compact-adaptive dialogs instead (they only go full-screen on narrow viewports via `app-compact-fullscreen-dialog`).

**Hints**

- The entry editor's `mat-chip-listbox` filter chips (entry-activation) are the app's filter-chip idiom — reuse them before inventing a bespoke control.
- Chip-set layout lives on Material's internal `.mdc-evolution-chip-set__chips` flex row; restyle that class from the global overlay stylesheet.
