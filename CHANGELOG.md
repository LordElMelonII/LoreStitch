# LoreStitch Changelog

What's new in LoreStitch. This file also powers the in-app **About → Changelog** viewer.

## 1.11.0 — October 1, 2026

### Highlights

- **Update notice** — when a release ships while LoreStitch is open, a notice with a Reload button
  appears. Ignore it and nothing changes; the next launch brings the update anyway.
- **Reload saves first** — accepting the Reload saves pending text before refreshing, so a
  mid-sentence refresh loses nothing.
- **Update check on return** — reopening the app (an installed app resumed, a background tab) checks
  for a newer version and speaks up if one shipped.

## 1.10.0 — September 30, 2026

### Highlights

- **One project, one tab** — opening a project already being edited in another tab asks before
  anything happens: take over and edit here (the other tab saves its latest changes, then turns
  read-only) or stay read-only yourself. Either way, no edit is thrown away.
- **Read-only tabs say so** — the paused tab shows a "Read-only" marker in the toolbar and a paused
  editor that explains why, each with a one-click way to ask for the project back. A stray edit
  attempt gets an explanation instead of a silent no-op.
- **Tab close saves pending edits** — closing or hiding a tab right after typing writes the waiting
  keystrokes on the way out.
- **Lock recovery** — if the tab holding the project closes or crashes, a read-only tab picks the
  project back up on return, latest saved edits included.
- **Re-import guard** — importing a `.stproj` whose project is open in another tab is refused with
  an explanation instead of overwriting that tab's work.

## 1.9.1 — September 30, 2026

### Highlights

- **License tab** — the About dialog gains a License tab with the full GNU Affero General Public
  License v3.0 text, readable offline; the repository carries the LICENSE file too.
- **SillyTavern credit** — the Open Source tab credits SillyTavern up front: the world-info matching
  logic is ported from its code.

## 1.9.0 — September 29, 2026

### Highlights

- **Range selection** — shift-click a checkbox (press-and-hold on touch) and every entry between it
  and the last checkbox you tapped fills in: tick an unticked row and the run selects, untick a
  ticked one and it clears, in either direction. Plain clicks and row activation are unchanged.
- **Long titles truncate** — sprawling entry names shorten with an ellipsis; Duplicate and Delete
  stay pinned at the row's edge. The list no longer grows a sideways scroll.
- **Key chips with "+N" overflow** — keys render as whole chips; the ones the row can't hold fold
  into a "+N" chip that lists them in its tooltip. A wider drawer shows more chips.
- **Resizable drawer** — on desktops and tablets the entries drawer resizes between 320 and 480 px:
  drag its edge, or focus it and nudge with the arrow keys (Home and End jump to the limits, a
  double-click snaps back to the default). The width is remembered between sessions; the editor
  follows while you drag.
- **Phone drawer is a full panel** — on phones the entries drawer covers the whole screen and
  carries its own close button.

### Fixed

- **Tab strips coast on touch** — swiping the editor's tab strip no longer stops dead on finger
  lift; it glides on with the swipe's speed.

## 1.8.0 — September 28, 2026

### Highlights

- **Typing keeps up on big books** — on lorebooks with hundreds of entries, text commits after a
  short pause (~300 ms) instead of re-scanning the whole book per keystroke, and heavy book-wide
  work is remembered instead of redone. Words render instantly; tab markers, row token counts and
  saving trail by the same beat.
- **Drafts survive interruptions** — when another action touches the entry mid-typing (delimiter
  apply, settings chip, batch edit), the fields you weren't typing in leave your words alone; only
  when both touch the same field does the newer action win.
- **Health check with progress** — Health opens instantly into a progress bar instead of freezing,
  finishes in about half the time, and is near-instant on every reopen or filter toggle. The shield
  badge counts the checks it can make on the spot; recursion loops and self-triggers join in the
  pane's full pass.
- **Token battery** — the Always Active Token Footprint meter fills like a battery as always-active
  entries consume the budget: warning tone near the limit, error state with a warning mark once
  over. Phones keep the compact circle, wearing the same states.
- **Top bar and editor tidied** — related top-bar actions are framed by dividers; Focus mode moved
  from the top bar into the entry's content field, beside delimiters (desktop); About moved to the
  welcome screen (in the More menu with a project open).

### Fixed

- **Phone export menu fits short screens** — the Export menu caps its height and scrolls inside
  instead of spilling past the top on shorter phones.

## 1.7.0 — September 26, 2026

### Highlights

- **Batch delimiters** — check entries in the list and the batch toolbar's Delimiters button (bottom
  bar on phones) opens the pane locked to exactly those entries; apply wraps every checked entry,
  each under its own name. The selection count rides a badge on the select-all checkbox.
- **Markdown style** — content can wear an ATX heading ("## Entry Name"), level # through ###### (##
  by default), with an optional trailing --- divider. A heading counts as a delimiter only when it
  spells the entry's own name; ordinary markdown prose is never swallowed.
- **Style switches clean up** — a trailing --- reads as the previous style's marker and is consumed
  on switch; a scene break inside a wrapped entry (with content after it) stays put. The preview
  shows exactly what will be written.
- **Broken markdown headers flagged** — a bare "##" or a "#Name" with the space glued on is
  classified like other malformed shapes and repairs to one clean wrapper, the text beneath
  untouched.
- **Phone pane is a bottom sheet** — the delimiters pane opens as a proper sheet on phones instead
  of a full-screen takeover.

## 1.6.0 — September 25, 2026

### Highlights

- **One-click id repair** — importing a book with duplicate, text, or missing entry ids shows
  exactly what would change, entry by entry ("Tavern: id "7" → 7"), before anything happens. Apply
  the fixes and import, or bring the file in exactly as it is.
- **No more vanishing entries** — SillyTavern stores entries under their id, so two entries sharing
  one id meant one silently disappeared on the way back in. Every export checks first; a repaired
  book keeps every entry under its own unique id.
- **Exports can't carry broken data** — if something can't be fixed automatically, the export stops
  and tells you what and where instead of writing a file that loses entries. Clean books export
  byte-for-byte as before.

## 1.5.0 — September 23, 2026

### Highlights

- **Character card import/export** — importing a character card PNG or card JSON (V2 or V3) turns
  the embedded lorebook into a normal project, titled after the character. The Export menu's
  "Character card" section hands the card back: the edited book goes into the same card image or
  JSON, under its original name.
- **Cards stay whole** — only the lorebook is edited: the artwork, the character's name and
  descriptions, greetings, custom fields other tools added, and unrelated data inside the PNG all
  ride along untouched. A file that isn't a card — or a card without a lorebook — is refused with a
  plain-language message.
- **Picker names its formats** — the Projects menu opens "lorebook or card…" with a tooltip listing
  every accepted format; the welcome screen's import button says "lorebook or character card" with a
  short format line.

## 1.4.1 — September 21, 2026

### Highlights

- **Phone batch bar** — selecting entries on a phone shows the same full-width strip of five labeled
  buttons as the default bar — Select all (with the count and a checkbox mark), Batch edit, Export,
  More, Clear — replacing the cramped pill of bare icons.

## 1.4.0 — September 21, 2026

### Highlights

- **Test keys verdict** — the panel ends with a clear entry-level answer — "Would be inserted into
  SillyTavern's context for this sample" or "Would not be inserted" — with the reason named: a
  disabled entry, no primary keys, no primary key match, or the secondary-key logic turning a match
  away. Secondary logic is read exactly the way SillyTavern does (a matched secondary key under NOT
  Any / NOT All is a block, not a green light).
- **Probability, honestly told** — entries that rely on a probability roll (anything below 100%) get
  a dice-marked verdict instead of a promise. Stated limits: chat history, scan depth, recursion,
  timed effects and inclusion groups are not simulated.
- **Search without the stall** — on large lorebooks the sidebar filter and the Search & Replace
  preview wait ~200 ms after your last keystroke instead of re-reading every entry per letter.
  Results are unchanged.
- **Phone bottom bar stays put** — opening a drawer or dialog no longer makes the bottom bar vanish
  and pop back; it stays docked, dimmed and inert behind what you opened.
- **Batch toolbar in place on phones** — selecting entries swaps the bottom bar's quick actions for
  the batch toolbar in place; rows no longer jump down when it appears, and its ✕ no longer
  overflows on narrow screens. Tablets and desktops keep the inline toolbar.
- **Steadier batch delete** — cancelling the delete confirmation while batch editing on a phone no
  longer disrupts the bar's focus recovery.

## 1.3.0 — September 20, 2026

### Highlights

- **Test keys against sample text** — entries with keys carry a "Test keys" section: type a sample
  and every primary and secondary key is checked on the spot — each row reports whether it matches
  and shows the words around the first hit, and a highlighted preview paints every match. Honors the
  entry's case-sensitivity and whole-word settings; options left at "Default" use SillyTavern's own
  (case-insensitive, substring).
- **Regex chips marked** — a key like `/(?:saber|artoria)/i` wears a small function symbol on its
  chip, in both the primary and secondary lists.
- **Broken regexes caught** — a key with the `/regex/flags` shape that doesn't compile gets an error
  mark on its chip with a tooltip; the test panel treats it the way SillyTavern does: as plain text.

## 1.2.0 — September 19, 2026

### Highlights

- **Health check** — a shield button in the top bar (and "Health check…" in the More menu) scans the
  whole lorebook and groups findings into errors, warnings and notes, each row naming its entry. A
  count badge on the shield drops as you fix things.
- **Jump to the problem** — every finding's buttons take you to the offending entry in one click;
  when several entries share a finding, each gets its own named button.
- **You decide what matters** — mute a whole kind of check with the filter chips, or mark a single
  finding "not an issue". Both are remembered in the saved project; "Undo all" brings everything
  back.
- **SillyTavern-faithful checks** — duplicate keys, ignored secondary keys, entries that can never
  activate, recursion loops, invalid regex keys and malformed whole-content wrappers, detected with
  the same matching rules SillyTavern applies.

### Fixed

- Long entry names in a finding's chip truncate to one line instead of wrapping.
- On narrow phones the filter chips stack one per row instead of pairing up.

## 1.1.1 — September 19, 2026

### Fixed

- **Mismatched and unclosed delimiters recognized** — the entry editor's delimiter badge flags
  content whose tags don't match (an opening `<test>` closed by a `</universe>`) or whose closing
  tag never arrives.
- **No wrappers inside wrappers** — applying a style to such an entry replaces the broken pair with
  one clean wrapper; the None style removes it. The preview shows the repair before anything is
  written.
- **The dialog says what it found** — affected entries get a "mismatched" or "unclosed" chip, a row
  hint naming the broken tags, and a banner counting the entries that will change.

## 1.1.0 — September 19, 2026

### Highlights

- **Phone bottom bar** — New entry, Search, Export, Batch edit and History sit in a bar along the
  bottom edge; the top row keeps only what it truly needs. Tablets and desktops unchanged.
- **Dialogs as bottom sheets** — Batch edit, the merge resolver, the export-selection pane and the
  About dialog open as full-height bottom sheets on phones, with their action buttons pinned in
  place.
- **Touch menus behave** — tapping Export or Theme in a menu no longer makes the submenu blink out
  of existence before you can tap it.

### Improvements

- Every button, chip and row meets a 44px touch floor (48px on phones).
- Closing a drawer no longer slides the editor sideways; drawers close with Escape even when opened
  from the bottom bar.
- Batch edit asks you to pick entries first when nothing is selected, instead of staying silent.

## 1.0.0 — September 17, 2026

First official release: an offline studio for authoring SillyTavern lorebooks (World Info) with
Git-style versioning built in — everything runs in your browser, and projects never leave your
device.

### Highlights

- **SillyTavern-faithful entry editor** — keys, activation, placement, recursion and timing settings
  mirror the World Info panel one-to-one, so nothing is lost on the way back into SillyTavern. Edit
  several entries at once in tabs.
- **Version control for lorebooks** — commit snapshots with messages, a live "unsaved changes"
  indicator, a history drawer with side-by-side diffs, and one-click rollback. History is never
  rewritten: rollbacks become new commits.
- **Round-trip-safe import & export** — open native SillyTavern World Info JSON, V2-spec Character
  Books, or `.stproj` project archives. Unknown fields are preserved so files come back out exactly
  as they went in.
- **Four export flavors** — World Info JSON for SillyTavern, full `.stproj` backups (commit history
  included), standard Character Book JSON, and a readable Markdown proofread digest.
- **Merge with a resolver** — combine another lorebook into your project and decide entry-by-entry:
  import, overwrite, or skip, with diff previews.
- **Batch tools** — regex-powered search & replace across contents, keys and names, plus delimiter
  tools that wrap, change or strip `<tag>`, `[name=…]` and `---` styles with a live preview.
- **Token meter** — a live estimate of how much of the context budget your always-active entries
  consume.
- **Private by design** — everything is stored locally in your browser; the app installs as a PWA
  that works fully offline.

### Improvements

- Material Design 3 theming: light (azure blue), dark (cyan-orange), and system-follow mode.
- Responsive layout with touch support: draggable tab strip, mobile-friendly drawers, 48px touch
  targets on phones.
- Focus mode (desktop) narrows the editor to a comfortable reading width.

### Notes

- Found a problem or have a wish? Open an issue on the
  [GitHub repository](https://github.com/LordElMelonII/LoreStitch) — the About dialog links straight
  to it.
