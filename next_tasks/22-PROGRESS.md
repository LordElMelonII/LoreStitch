# Task 22 progress ledger — ARD agent-discovery manifests

Plan: [22-ard-ai-catalog-manifest.md](./22-ard-ai-catalog-manifest.md) ·
Branch: `feature/22-ard-ai-catalog-manifest` (off `develop` @ `abfab3e`).

## P1 — Implementation + gates (2026-09-29, single phase)

**Diagnosed**: live site answers `/.well-known/ai-catalog.json` (and
`/ai-catalog.json`, `/…/ard.json`) with the SPA fallback — 200 +
`text/html` `<!doctype html>` (curl, both paths) — so ARD validators parse
HTML as JSON. No manifest was ever published; spec refs pulled from
`ards-project/ard-spec` @ `main` (`spec/ard.md` §5.1 resolution rules,
`spec/schemas/*.json`, `conformance/examples/basic/ard.json`).

**Landed** (single-phase task; no subagent dispatch — static assets +
two `<head>` links, no component/service surface):

- `public/.well-known/ai-catalog.json` + `public/.well-known/ard.json`
  (byte-identical): host block (LoreStitch, llms.txt as documentationUrl,
  `icons/icon-512x512.png` logo, `https`-identity trustManifest) + three
  entries — `urn:air:lorestitch.pages.dev:app:editor` (v1.9.0,
  updatedAt = v1.9.0 release commit timestamp),
  `urn:air:lorestitch.pages.dev:docs:llms-txt`, and
  `urn:air:lorestitch.pages.dev:source:repository` (public GitHub repo,
  user-confirmed mid-task; verified 200 unauthenticated).
- `src/index.html`: `<link rel="ard">` + `<link rel="ai-catalog">`.

**Gates run**: ajv 8.20 (`ajv/dist/2020`, strict:false) against the two
official schemas — both files VALID. `npm run build` green;
`dist/lore-stitch/browser/.well-known/{ai-catalog,ard}.json` present and
output `index.html` carries both link tags. `npm run lint` green. Full unit
suite `CI=true npm test -- --watch=false`: 63 files / 1446 tests passed
(coverage thresholds enforced inside the run).

**Deviation**: branch-final three-project Playwright sweep skipped — zero
e2e surface (no touched/authored specs; static files + head links outside
every pinned selector; ngsw asset groups exclude `.well-known`). Recorded
in the plan; re-run pre-merge on request.

**Commit**: `fix(site): serve valid ARD agent-discovery manifests` —
then `docs(next_tasks): task 22 complete (ARD manifests)` (this ledger +
plan + README note).

**Next**: user merges (ff-only) after checking the deployed site answers
both paths with JSON once Cloudflare Pages rebuilds.
