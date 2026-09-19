# features/entry-list/

Sidebar entry list: quick filter, per-entry actions (add, duplicate, delete, drag-to-reorder synced with SillyTavern's display index), dirty badges. `batch-operations-dialog` applies bulk patches (trigger strategy, insertion order set/shift, scan depth…) built by `batch-operations.model.ts`.

**Hints**

- The dialog is a dual-container pane (bottom sheet on phones) — open it via `ResponsiveOverlayService.openResponsive`.
