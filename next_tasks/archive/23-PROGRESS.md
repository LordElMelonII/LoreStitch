# Task 23 progress ledger — About dialog License tab + SillyTavern credit

Branch: `feature/23-about-license` (off `develop` @ `1159ad5`). Direct user
intake (no plan file): "Add LICENSE. Add it in the About Dialog in its own
tab. Add a reference to sillytavern in the Open Source tab too. World-info.js
was taken from Sillytavern since this is a tool mainly aimed at it."

## P1 — Implementation + review + gates (2026-09-30, single phase)

**Landed** (no subagent dispatch for implementation — small, pattern-following
task; `ts-reviewer` ran as a real review pass):

- `LICENSE` (repo root): verbatim AGPL-3.0, byte-identical to gnu.org
  `agpl-3.0.txt` (the user-pasted copy carried one substantive wording
  deviation at the "User Product" definition and two re-wrapping hunks —
  ts-reviewer caught it against the canonical text; file replaced wholesale).
- `package.json`: `"license": "AGPL-3.0-only"` (the license text carries no
  "or later" grant).
- `angular.json` + `ngsw-config.json`: `LICENSE` bundled to the output root
  and precached by the service worker's `app` group — same path CHANGELOG.md
  already takes, so the tab reads fine offline.
- `open-source.ts`: new leading group "Ported source" with the SillyTavern
  credit (AGPL-3.0-only, `github.com/SillyTavern/SillyTavern`) — world-info
  key matching/regex handling is ported from its `world-info.js`
  (`st-key-match.ts` precedent; the vendored oracle lives in
  `sillytaver-world-info-doc/`).
- `about-dialog.{ts,html,scss}`: `loadChangelog` generalized to
  `loadTextAsset(file, abortSignal)`; a fourth "License" tab (loading /
  failure with "Read it on GitHub" / summary paragraph linking gnu.org's
  annotated copy / full text in a monospace pre-wrap box; degenerate
  empty-asset state added on ts-reviewer's P2).

**Tests**: unit fetch stub routes by asset URL; new specs for license render,
fetch-failure fallback, empty-asset degenerate state, and the SillyTavern
credit; e2e tab enumeration extended, open-source test pins
SillyTavern/AGPL-3.0, new license-tab e2e test. `about-dialog.ts` branch
coverage 91.66% vs the 90.47% develop baseline (the two remaining uncovered
branches are pre-existing: `runMode`'s Production side, `releases`' null
side).

**Gates run**: `npm run build` green; full suite `CI=true npm test --
--watch=false` 63 files / 1449 tests passed (thresholds enforced inside the
run); `npm run lint` green; `npm run typecheck:e2e` green; Playwright smoke
`npx playwright test about-dialog --project=desktop-chrome` 6 passed / 2
skipped (phone-pinned, by design).

**Visual baseline** (`__screenshots__/23-about-license/{before,after}/`,
pinned chromium/light/1280+1024+390/fresh-context, `capture.mjs` alongside):
before = 3 tabs, no credit row (develop tree); after = SillyTavern leading
the Open Source tab + License tab rendering the fetched AGPL text (desktop,
tablet, mobile). Mobile paginates the 4-tab header (Material arrows) —
accepted. Capture gotcha recorded: `ng serve` does not register a NEW
angular.json asset until restart — the first after-run SPA-fell-back
`/LICENSE` to `index.html`; server restart fixed it (prod build was never
affected).

**ts-reviewer findings**: P0 LICENSE verbatim deviation (fixed — canonical
replace); P2 SPDX `AGPL-3.0` → `AGPL-3.0-only` in the credit chip (fixed);
P2 empty-asset branch (fixed + tested); P2 pre-existing explicit
`changeDetection: OnPush` on about-dialog.ts (predates branch, left alone —
separate cleanup decision).

**Commits**: `chore(license): adopt AGPL-3.0-only with the canonical license
text` + `feat(about): add License tab and SillyTavern ported-source credit`
+ this ledger.

**Next**: user merges (ff-only) after testing the branch. Branch-final
three-project Playwright sweep still pending at close (only desktop-chrome
smoke ran in-task).

---

## Close-out

- **Status**: ✅ merged — branch ff-merged into `develop` (`3f715ed` +
  `47ce0e5` + docs); shipped as v1.9.1 (2026-09-30). The pending
  branch-final sweep was covered by task 24's three-project run over the
  merged tree (its branch cut from `809ecf6`, which contains task 23) —
  zero failures across all projects (24-PROGRESS).
