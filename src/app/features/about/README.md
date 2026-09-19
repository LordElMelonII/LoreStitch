# features/about/

The About dialog (About / Changelog / Open Source tabs): app version + build metadata from `core/models/build-info`, an in-app viewer for `CHANGELOG.md` (`changelog.ts`; the file ships as a build asset via `angular.json`), and third-party license info (`open-source.ts`).

**Hints**

- Bump versions through the release ritual in `AGENTS.md` — the changelog tab renders whatever `CHANGELOG.md` contains, no code change needed.
