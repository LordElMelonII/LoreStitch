# features/entry-editor/

Tabbed entry editor: one tab per open entry, panes grouped by SillyTavern World Info field area (one subfolder each). `entry-updates.service.ts` funnels all entry edits into `WorkspaceService` mutators; `entry-edit-form.ts` builds the tab form; `_shared.scss` holds common pane styles. The session veil (`sessionVeiled`) covers the pane — content `[attr.inert]` — while another tab holds the project's lock (`SessionLockService`, task 11), restating why and offering the takeover retry.

**Hints**

- Unit/e2e assertions must scope to the active tab body (`.mat-mdc-tab-body-active`) — inactive mat-tabs keep their inputs in the DOM.
