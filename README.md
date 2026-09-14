# LoreStitch

LoreStitch is an offline studio for authoring [SillyTavern](https://sillytavern.ai) lorebooks (World Info) and character cards, with Git-style versioning built in.

**🌐 Try it online: [https://lorestitch.pages.dev/](https://lorestitch.pages.dev/)**

Everything runs entirely in your browser — projects are stored locally in IndexedDB, and no data ever leaves your device. It also works as a PWA, so you can install it and use it offline.

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org) `^22.22.3`, `^24.15.0`, or `^26.0.0` ([Angular 22 requirement](https://angular.dev/reference/versions))
- npm (bundled with Node.js)

### Install and run

```bash
npm install
npm start
```

Then open `http://localhost:4200/` in your browser. The dev server reloads automatically when you change any source file.

### Other scripts

| Command           | What it does                                            |
| ----------------- | ------------------------------------------------------- |
| `npm run build`   | Production build into `dist/`                           |
| `npm test`        | Unit tests (Vitest)                                     |
| `npm run e2e`     | End-to-end tests (Playwright)                           |
| `npm run lint`    | ESLint (`npm run lint:fix` to auto-fix)                 |
| `npm run format`  | Prettier (`npm run format:check` to check only)         |

## Features

### Projects, stored locally

- Create multiple projects, each holding one lorebook and its own version history.
- Everything persists in your browser's IndexedDB with debounced auto-saving, so you never lose edits — even if you close the tab. The last-opened project reopens automatically on your next visit.
- Recent projects are listed on the welcome screen and in the topbar for quick switching, renaming, and deletion.

### Deep, SillyTavern-faithful entry editor

The editor mirrors SillyTavern's World Info fields one-to-one, so nothing is lost when you export back into SillyTavern. Entries are edited in tabs so you can work on several at once.

- **Keys** — primary and secondary (optional filter) keys as editable chips, with the four SillyTavern logic modes: *AND Any*, *NOT All*, *NOT Any*, *AND All*.
- **Activation** — enable/disable, tri-state trigger strategy (🟢 Normal / 🔵 Constant / 🔗 Vectorized), insertion order, priority within the token budget, per-entry scan depth, insertion probability, and a generation-type trigger filter (normal, continue, impersonate, swipe, regenerate, quiet), plus a character activation filter with optional exclusion.
- **Placement** — every SillyTavern insertion position: Before/After Char Defs, Before/After Example Messages, Top/Bottom of Author's Note, `@ Depth` (with chat depth and system/user/assistant role), and manual Outlet entries (pulled into the prompt via the outlet macro).
- **Recursion & timing** — non-recursable, prevent-recursion, delay-until-recursion (with recursion level), sticky, cooldown, and delay settings.
- **Matching** — case sensitivity and per-entry whole-word matching.
- Less-used options are tucked into collapsible accordion sections to keep the workspace tidy.

### Version control for lorebooks

- **Commits** with messages, just like Git. Commit ids are content-addressed SHA-256 hashes (derived from the parent id plus the book contents), so identical states produce identical hashes.
- A live **dirty indicator** on the project badge and on each editor tab shows exactly which entries differ from the last commit.
- **Commit history drawer** with a side-by-side diff viewer per commit, and one-click **rollback** to any previous state. Rollbacks are recorded as new commits, so history is never rewritten.

### Import & export

- **Import** auto-detects the format: SillyTavern character cards (V2 JSON), native SillyTavern world-info exports, bare V2-spec Character Book JSON, or LoreStitch `.stproj` project archives. Unknown fields are preserved so imports round-trip untouched.
- **Merge** another lorebook into the current project through a merge resolver: for every incoming entry you choose to import it, overwrite the local version, or skip it, with diff previews of the clashes.
- **Export** in five flavors:
  - *World Info JSON* — native SillyTavern format, importable via the World Info panel.
  - *Character Card V2 JSON* — full card with the lorebook embedded, original card metadata preserved.
  - *Project archive (`.stproj`)* — full backup including the entire commit history, reopenable in LoreStitch.
  - *Character Book JSON* — bare V2-spec `character_book`, no card wrapper.
  - *Proofread digest (Markdown)* — all entries rendered as readable text with order, keys, and a rough token estimate, handy for review or sharing.

### Batch tools

- **Search & replace** across entry contents, keys, and names, with regex mode, whole-word and case-sensitive matching, and a per-entry hit preview before applying.
- **Delimiter tools** to add, change, or remove content delimiters (`<tag>…</tag>`, `[name=…]`, `---` separators, or none) for a single entry or the whole book, using each entry's own name or a fixed one — with a live diff preview before applying.
- Per-entry actions: add, duplicate, delete, and drag-and-drop reordering (kept in sync with SillyTavern's display index).

### Interface

- Material Design 3 theming with light (azure blue), dark (cyan-orange), and system-follow modes.
- Fully responsive layout with touch support (touch-draggable tab strip, mobile-friendly panels), so it works comfortably on phones and tablets.
- Installable as a PWA and fully usable offline.

## Tech stack

[Angular](https://angular.dev) 22 (signals, standalone components) · [Angular Material](https://material.angular.dev) (Material Design 3) · IndexedDB via [`idb`](https://github.com/jakearchibald/idb) · Web Crypto (with a pure-JS SHA-256 fallback for insecure LAN origins) · Vitest & Playwright.
