# features/entry-list/

Sidebar entry list: quick filter, per-entry actions (add, duplicate, delete, drag-to-reorder synced with SillyTavern's display index), dirty badges. `batch-operations-dialog` applies bulk patches (trigger strategy, insertion order set/shift, scan depth…) built by `batch-operations.model.ts`.

**Hints**

- The dialog is a dual-container pane (bottom sheet on phones) — open it via `ResponsiveOverlayService.openResponsive`.
- Batch actions have two surfaces (Task 06): the header toolbar renders on tablet/desktop only; on phones the docked bottom bar (shell `mobile-bottom-bar/`) swaps to these actions instead. The shell drives them through the narrow public API (`selectionCount`, `allFilteredSelected`/`someFilteredSelected`, `exportSelection`, `duplicateSelection`, `setSelectionEnabled`, `deleteSelection`, `clearSelection`, `selectAllShown`) — never by reaching into the selection signal.
- The text filter is debounced (`debouncedSignal` over the form query, `SEARCH_DEBOUNCE_MS`): the input and its clear button stay immediate, while the scan — and the `Entries N` badge and empty-state message, which read `filtered()` — settle ~200ms after the last keystroke. Tag chips keep filtering immediately (discrete taps). Matching runs over a per-entry haystack pre-folded once per entry change (`EntryListItem.search`, built by `entrySearchHaystack`), so each keystroke costs a plain `includes` scan.
