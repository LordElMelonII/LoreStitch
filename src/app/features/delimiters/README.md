# features/delimiters/

Delimiter tools pane (dual-container since v1.7.0: dialog on tablet/desktop, bottom sheet on phones): add, change, or remove content delimiters (`<tag>…</tag>`, `[name=…]`, `---`, a Markdown heading, none) for one entry, the checked selection, or the whole book, with a live diff preview. Malformed wrappers (mismatched/unclosed tags, malformed Markdown headers) are flagged in the preview and repaired on apply (v1.1.1).

**Hints**

- All wrap/strip/repair logic lives in `core/models/delimiters.ts` — the dialog only presents it.
