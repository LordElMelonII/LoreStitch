# public/

Static assets copied verbatim to the deploy root: PWA `manifest.webmanifest`, favicon + `icons/` PNG set, `fonts/`, `llms.txt` + `robots.txt` (crawler guidance), `_headers` (Cloudflare Pages), and `.well-known/` (the byte-identical ARD agent-discovery twins `ai-catalog.json` / `ard.json`). `CHANGELOG.md` is bundled as a root asset from the repo root via `angular.json`, not from here.
