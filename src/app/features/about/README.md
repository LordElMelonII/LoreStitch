# features/about/

The About dialog (About / Changelog / Open Source / License tabs): app version + build metadata from `core/models/build-info`, an in-app viewer for `CHANGELOG.md` (`changelog.ts`; the file ships as a build asset via `angular.json`), third-party license info plus the SillyTavern ported-source credit (`open-source.ts`), and the full AGPL-3.0 license text fetched from the bundled `LICENSE` asset (also a build asset via `angular.json`).

**Hints**

- Bump versions through the release ritual in `AGENTS.md` — the changelog tab renders whatever `CHANGELOG.md` contains, no code change needed.
