# Task 22 — ARD agent-discovery manifests (`ai-catalog.json` / `ard.json`)

**Status**: ✅ Complete on `feature/22-ard-ai-catalog-manifest` (2026-09-29),
awaiting user merge + deploy.
**Source**: 🔴 Urgent — external validator report on the live site:
"ai-catalog.json schema is invalid … Malformed JSON in manifest:
SyntaxError: Unexpected token '<', "<!doctype "… is not valid JSON".
**Grounded at**: `develop` @ `abfab3e`.

## Root cause

The ARD (Agent Resource Discovery) spec has sites publish a discovery
manifest at `/.well-known/ai-catalog.json` (predecessor path; the current
spec revision renames it to `/.well-known/ard.json` + `rel="ard"`, keeping
the old path as a courtesy source — Lighthouse 13.5's ARD audit still checks
`ai-catalog.json`). LoreStitch never published one, and Cloudflare Pages'
SPA fallback answers every unknown path — including both manifest paths —
with **200 + `index.html`** (verified by curl: `text/html`, `<!doctype html>`).
Validators fetch that, try to parse it as JSON, and fail with exactly the
reported error.

## Fix

- `public/.well-known/ai-catalog.json` + `public/.well-known/ard.json` —
  one document served at both paths (byte-identical; `ard.json` is the
  canonical current path, `ai-catalog.json` the predecessor validators
  fetch). Three entries: the web app (`text/html`, browser-only,
  local-first guarantees, formats), `llms.txt` (`text/markdown`) and the
  public GitHub repo (source + docs; user-confirmed 2026-09-29). Host block
  with `https`-identity trustManifest (no `did:web` — the domain serves no
  DID document; honesty over decoration). `public/**/*` is copied verbatim
  by the build (`angular.json` assets), so both land at the site root.
- `src/index.html` — `<link rel="ard">` + `<link rel="ai-catalog">` tags
  per the spec's HTML-link discovery channel.

Deliberately **not** included: `_headers` changes (platform default
`max-age=0, must-revalidate` is correct for a catalog).

## Verification

- Both files validated with bundled ajv 8.20 (`ajv/dist/2020`) against the
  official schemas (`ai-catalog.schema.json`; `ArdManifest` from
  `ard-entry.schema.json`, `ards-project/ard-spec` @ `main`) — VALID.
- Gates: `npm run build` (`.well-known/` + link tags verified in
  `dist/lore-stitch/browser/`), `npm run lint`, full unit suite
  (63 files / 1446 tests green, coverage thresholds enforced in-run).
- Branch-final Playwright sweep **skipped as a documented deviation**: the
  delta is two static JSON files + two `<head>` link tags with zero e2e
  surface (no spec pins head links or `.well-known` paths; the service
  worker's asset groups don't include them). Run the sweep pre-merge if
  wanted; nothing here should move it.
- Live-site verification of the actual fix requires deploy (Cloudflare
  Pages builds from the repo); after merge, both paths must answer
  `200` + `application/json` instead of the SPA fallback.
