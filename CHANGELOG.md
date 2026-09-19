# LoreStitch Changelog

What's new in LoreStitch — written for writers, not for machines. This list also
powers the in-app **About → Changelog** viewer, so it stays with you even offline.

## 1.2.0 — September 19, 2026

The health-check release. One click tells you what SillyTavern never does:
which entries can never fire, which keys collide, which tags are broken, and
which regexes will quietly do nothing — plus the tools to tune away what you
already know about.

### Highlights

- **Health check, one click away** — a new shield button in the top bar (and a
  "Health check…" item in the More menu on every device) scans the whole
  lorebook and groups what it finds into errors, warnings and notes, each row
  naming the entry it concerns. A count badge on the shield shows how much is
  waiting, and it drops as you fix things.
- **Jump straight to the problem** — every finding's buttons take you to the
  offending entry with one click; when several entries share a finding, each
  gets its own named button.
- **You decide what matters** — mute a whole kind of check with the filter
  chips, or mark a single finding "not an issue". Both are remembered in the
  saved project, and "Undo all" brings everything back.
- **Checks that speak SillyTavern's language** — duplicate keys, ignored
  secondary keys, entries that can never activate, recursion loops, invalid
  regex keys and malformed whole-content wrappers are detected with the same
  matching rules SillyTavern itself applies — including the ones it silently
  ignores.

### Fixed

- Long entry names in a finding's chip now stay on one line (truncated)
  instead of wrapping.
- On narrow phones the filter chips stack one per row instead of pairing up.

## 1.1.1 — September 19, 2026

A quiet repair for the delimiter tools. Wrappers that don't line up — an opening
`<test>` closed by a `</universe>`, or a tag left hanging — used to be invisible,
and applying a style could nest a second wrapper around them. Now they're
spotted, flagged, and cleaned up in the same previewed flow as before.

### Fixed

- **Mismatched and unclosed delimiters are recognized** — the entry editor's
  delimiter badge now flags content whose tags don't match or whose closing tag
  never arrives, instead of staying silent.
- **No more wrappers inside wrappers** — applying a style to such an entry
  replaces the broken pair with one clean wrapper, and the None style removes
  it. The preview shows the repair before anything is written.
- **The dialog says what it found** — affected entries get a "mismatched" or
  "unclosed" chip, a row hint naming the broken tags, and a banner counting the
  entries that will change.

## 1.1.0 — September 19, 2026

The phone release. LoreStitch now feels at home under your thumb: every core
action lives in a bottom bar, every dialog opens as a sheet you can actually
reach, and nothing expects a keyboard anymore. Working on a desktop? Everything
is exactly where you left it.

### Highlights

- **A bottom bar built for your thumb** — New entry, Search, Export, Batch edit
  and History now sit in a bar along the bottom edge of the screen, and the top
  row keeps only what it truly needs. On tablets and desktops, nothing moves.
- **Dialogs that fit your screen** — Batch edit, the merge resolver, the
  export-selection pane and the About dialog open as full-height bottom sheets
  on phones, with their action buttons pinned in place — no more scrolling to
  find "Apply".
- **Menus that behave on touch** — tapping Export or Theme in a menu no longer
  makes the submenu blink out of existence before you can tap it.

### Improvements

- Every button, chip and row now meets a 44px touch floor — 48px on phones —
  so mistaps become the exception.
- Closing a drawer no longer slides the editor sideways, and drawers close with
  the Escape key even when they were opened from the bottom bar.
- Batch edit explains itself: with nothing selected it politely asks you to
  pick entries first instead of staying silent.

## 1.0.0 — September 17, 2026

LoreStitch's first official release! An offline studio for authoring SillyTavern
lorebooks (World Info), with Git-style versioning built in. Everything runs in
your browser — your projects never leave your device.

### Highlights

- **Deep, SillyTavern-faithful entry editor** — keys, activation, placement,
  recursion and timing settings mirror the World Info panel one-to-one, so
  nothing is lost on the way back into SillyTavern. Edit several entries at
  once in tabs.
- **Version control for lorebooks** — commit snapshots with messages, a live
  "unsaved changes" indicator, a history drawer with side-by-side diffs, and
  one-click rollback. History is never rewritten: rollbacks become new commits.
- **Round-trip safe import & export** — open native SillyTavern World Info
  JSON, V2-spec Character Books, or LoreStitch project archives. Unknown fields
  are preserved so files come back out exactly as they went in.
- **Four export flavors** — World Info JSON for SillyTavern, full `.stproj`
  backups (commit history included), standard Character Book JSON, and a
  readable Markdown proofread digest.
- **Merge with a resolver** — combine another lorebook into your project and
  decide entry-by-entry: import, overwrite, or skip, with diff previews.
- **Batch tools** — regex-powered search & replace across contents, keys and
  names, plus delimiter tools that wrap, change, or strip `<tag>`, `[name=…]`
  and `---` styles with a live preview.
- **Token meter** — a live estimate of how much of the context budget your
  always-active entries consume.
- **Private by design** — everything is stored locally in your browser and the
  app installs as a PWA that works fully offline.

### Improvements

- Material Design 3 theming with a light (azure blue), dark (cyan-orange), and
  system-follow mode.
- Responsive layout with touch support — draggable tab strip, mobile-friendly
  drawers, and 48px touch targets on phones.
- Focus mode (desktop) narrows the editor to a comfortable reading width.

### Notes

- Found a problem or have a wish? Open an issue on the
  [GitHub repository](https://github.com/LordElMelonII/LoreStitch) — the About
  dialog links straight to it.
