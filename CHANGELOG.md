# LoreStitch Changelog

What's new in LoreStitch — written for writers, not for machines. This list also
powers the in-app **About → Changelog** viewer, so it stays with you even offline.

## 1.4.1 — September 21, 2026

A shape-up for the phone batch bar. Selecting several entries used to trade
the bottom bar's labeled buttons for a cramped strip of icons — now it wears
the same comfortable five-button shape as the rest of the app.

### Highlights

- **Batch actions look at home** — on phones, picking entries used to swap
  the bottom bar for a squeezed pill: a bare checkbox, a count, and unlabeled
  icons. It now shows the same full-width strip of five labeled buttons as
  the default bar — Select all (with the count and a checkbox mark that
  follows your selection), Batch edit, Export, More, and Clear — so every
  action is named and just as easy to hit as before.

## 1.4.0 — September 21, 2026

The straight-answers release. Test keys now says outright whether the entry
would make it into SillyTavern's context; searching enormous lorebooks no
longer stutters; and the phone bottom bar finally sits still.

### Highlights

- **A verdict, not just clues** — the "Test keys" panel now ends with a clear
  entry-level answer: "Would be inserted into SillyTavern's context for this
  sample" or "Would **not** be inserted", with the reason named — a disabled
  entry, no primary keys, no primary key matching, or the secondary-key logic
  turning a match away. It reads your entry's secondary logic exactly the way
  SillyTavern does, so a matched secondary key under NOT Any / NOT All shows
  its true color: a block, not a green light.
- **Probability, honestly told** — entries that rely on a probability roll
  (anything below 100%) get their own verdict: insertion depends on a roll of
  the dice, shown with a dice mark instead of a promise. The verdict also
  states its known limits — chat history, scan depth, recursion, timed
  effects and inclusion groups are not simulated here.
- **Typing without the stall** — on enormous lorebooks, the sidebar filter and
  the Search & Replace preview now wait for a beat (~200ms) after your last
  keystroke before scanning, instead of re-reading every entry on every
  letter. The results themselves are unchanged — they just arrive without the
  typing struggle.
- **The phone bottom bar stays put** — opening a drawer or dialog no longer
  makes the bottom bar vanish and pop back; it stays docked, merely dimmed
  and inert behind whatever you opened. No more stutter in the layout.
- **Batch actions where your thumb is** — on phones, selecting several entries
  swaps the bottom bar's quick actions for the batch toolbar (edit, delete,
  and the rest) in place — fully tappable, just below the drawer. The rows no
  longer jump down when a selection toolbar appears, and the toolbar's ✕ no
  longer overflows on narrow screens. Tablets and desktops keep their inline
  toolbar as it was.
- **A steadier batch delete** — cancelling the delete confirmation while batch
  editing on a phone no longer disrupts the bar's focus recovery.

## 1.3.0 — September 20, 2026

The rehearsal release. Your keys no longer have to be a leap of faith: paste
in some text and watch, live, which of them would fire and where.

### Highlights

- **Test keys against sample text** — entries with keys now carry a "Test
  keys" section in the editor. Type a sample and every primary and secondary
  key is checked against it on the spot: each row tells you whether the key
  matches and shows the words around its first hit, and a highlighted preview
  paints every match in place across your text. The test honors the entry's
  case-sensitivity and whole-word settings, and options left at "Default"
  use SillyTavern's own defaults — case-insensitive, substring matching.
- **Regex keys look the part** — a key like `/(?:saber|artoria)/i` now wears
  a small function symbol on its chip, in both the primary and secondary
  lists, so regex keys are recognizable at a glance.
- **Broken regexes are caught on sight** — a key that has the `/regex/flags`
  shape but doesn't compile gets an error mark on its chip with a tooltip
  saying so, and the test panel reports it the way SillyTavern treats it:
  as plain text.

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
