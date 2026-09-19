# features/delimiters/

Delimiter tools dialog: add, change, or remove content delimiters (`<tag>…</tag>`, `[name=…]`, `---`, none) for one entry or the whole book, with a live diff preview. Malformed wrappers (mismatched/unclosed tags) are flagged in the preview and repaired on apply (v1.1.1).

**Hints**

- All wrap/strip/repair logic lives in `core/models/delimiters.ts` — the dialog only presents it.
