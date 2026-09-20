# features/search-replace/

Search & replace dialog: across entry contents, keys, and names; regex mode, whole-word/case-sensitive chips, per-entry hit preview before applying. Uses Angular's signal-based forms (`@angular/forms/signals`).

**Hints**

- The preview is debounced: the query and replacement feed `debouncedSignal` mirrors (`SEARCH_DEBOUNCE_MS`) that `pattern`/`rows` (and the hit counts derived from them) consume, so the O(book) scan runs once per settle window, not per keystroke. The match/scope/field chips stay immediate, and `patternError` validates the live query so invalid-regex feedback never lags. `apply()` flushes both mirrors first — a fast type→Replace always applies exactly what the inputs hold.
