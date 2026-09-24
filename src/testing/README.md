# testing/

Shared unit-spec fixtures: `project-fixtures.ts` (`projectOf` — workspace/book builders with `lintPrefs`/budget options), `match-media-stub.ts` (`installMatchMediaStub` — jsdom has no `matchMedia`; desktop/mobile answers flip mid-test), and `png-fixtures.ts` (hand-built PNG chunk/card builders for the character-card specs — `e2e/helpers.ts` builds on them too).

**Hints**

- Reuse these instead of copy-pasting helpers into specs — root `TEST-REPORT.md` traces the duplication the shared fixtures removed.
- `tsconfig.spec.json` includes `src/testing`; the e2e suite imports `png-fixtures.ts` via `e2e/helpers.ts`.
