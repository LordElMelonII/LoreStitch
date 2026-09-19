# LoreStitch

LoreStitch is an offline studio for authoring [SillyTavern](https://sillytavern.ai) lorebooks (World Info), with Git-style versioning built in.

**🌐 Try it online: [https://lorestitch.pages.dev/](https://lorestitch.pages.dev/)**

Everything runs entirely in your browser — projects are stored locally in IndexedDB, and no data ever leaves your device. It also works as a PWA, so you can install it and use it offline.

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org) `^22.22.3`, `^24.15.0`, or `>=26.0.0` ([Angular 22 requirement](https://angular.dev/reference/versions))
- npm (bundled with Node.js)

### Install and run

```bash
npm install
npm start
```

Then open `http://localhost:4321/` in your browser (the port is pinned in `angular.json`). The dev server reloads automatically when you change any source file.

### Other scripts

| Command          | What it does                                    |
| ---------------- | ----------------------------------------------- |
| `npm run build`  | Production build into `dist/`                   |
| `npm test`       | Unit tests (Vitest)                             |
| `npm run e2e`    | End-to-end tests (Playwright)                   |
| `npm run lint`   | ESLint (`npm run lint:fix` to auto-fix)         |
| `npm run format` | Prettier (`npm run format:check` to check only) |
| `npm run icons:refresh` | Re-subset the self-hosted Material Symbols font from the icons used in `src/` |

## Features

### Projects, stored locally

- Create multiple projects, each holding one lorebook and its own version history.
- Everything persists in your browser's IndexedDB with debounced auto-saving, so you never lose edits — even if you close the tab. The last-opened project reopens automatically on your next visit.
- Recent projects are listed on the welcome screen and in the topbar for quick switching, renaming, and deletion.

### Deep, SillyTavern-faithful entry editor

The editor mirrors SillyTavern's World Info fields one-to-one, so nothing is lost when you export back into SillyTavern. Entries are edited in tabs so you can work on several at once.

- **Keys** — primary and secondary (optional filter) keys as editable chips, with the four SillyTavern logic modes: _AND Any_, _NOT All_, _NOT Any_, _AND All_.
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

- **Import** auto-detects the format: native SillyTavern world-info exports, bare V2-spec Character Book JSON, or LoreStitch `.stproj` project archives. Unknown fields are preserved so imports round-trip untouched.
- **Merge** another lorebook into the current project through a merge resolver: for every incoming entry you choose to import it, overwrite the local version, or skip it, with diff previews of the clashes.
- **Export** in four flavors:
  - _World Info JSON_ — native SillyTavern format, importable via the World Info panel.
  - _Project archive (`.stproj`)_ — full backup including the entire commit history, reopenable in LoreStitch. Version history lives in the browser's IndexedDB, so export a `.stproj` regularly to keep a durable backup (the history drawer reminds you and has a one-click export).
  - _Character Book JSON_ — standard V2-spec `character_book` format (for character cards and third-party frontends).
  - _Proofread digest (Markdown)_ — all entries rendered as readable text with order, keys, and a rough token estimate, handy for review or sharing.

### Batch tools

- **Search & replace** across entry contents, keys, and names, with regex mode, whole-word and case-sensitive matching (filter chips), and a per-entry hit preview before applying.
- **Delimiter tools** to add, change, or remove content delimiters (`<tag>…</tag>`, `[name=…]`, `---` separators, or none) for a single entry or the whole book, using each entry's own name, its first primary key, or a fixed one — with a live diff preview before applying.
- Per-entry actions: add, duplicate, delete, and drag-and-drop reordering (kept in sync with SillyTavern's display index).

### Health check

- One click on the topbar shield (or "Health check…" in the More menu) scans the whole lorebook and groups what it finds into errors, warnings, and notes, each naming the entry it concerns — duplicate keys, ignored secondary keys, entries that can never activate, recursion loops, invalid regex keys, and malformed whole-content wrappers, detected with the same matching rules SillyTavern itself applies. A count badge on the shield shows how much is waiting.
- Every finding's buttons jump straight to the offending entry; when several entries share a finding, each gets its own named button.
- **You decide what matters** — mute a whole kind of check with the filter chips, or mark a single finding "not an issue". Both are remembered in the saved project, and "Undo all" brings everything back.

### Interface

- **Focus mode** (desktop only) narrows the editor column to a comfortable reading measure with one click on the topbar button.
- Diff viewers with **previous/next change** navigation, so long diffs can be stepped through hunk by hunk.
- Material Design 3 theming with light (azure blue), dark (cyan-orange), and system-follow modes.
- Fully responsive layout with touch support (touch-draggable tab strip, mobile-friendly panels), so it works comfortably on phones and tablets.
- Installable as a PWA and fully usable offline.

## Tech stack

[Angular](https://angular.dev) 22 (signals, standalone components) · [Angular Material](https://material.angular.dev) (Material Design 3) · IndexedDB via [`idb`](https://github.com/jakearchibald/idb) · Web Crypto (with a pure-JS SHA-256 fallback for insecure LAN origins) · Vitest & Playwright.
