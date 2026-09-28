# e2e/

Playwright suites over three projects: `desktop-chrome`, `mobile-chrome` (Pixel 7), `mobile-safari` (iPhone 14). The config boots its own dev server on port **4301** (`npm start -- --port 4301`). Reference lorebooks/cards live in `example_card/`; committed e2e input files (e.g. `defective-book.json` for `repair.spec.ts`) live in `fixtures/`.

**Hints**

- Filter by spec-name substring: `npx playwright test delimiters round-trip`.
- Phone-pinned tests skip on desktop projects — a large "skipped" count is by design.
- Entry editor assertions must scope to `.mat-mdc-tab-body-active` — inactive mat-tabs keep their inputs in the DOM.
- File upload/download cycles belong in `round-trip.spec.ts`.
