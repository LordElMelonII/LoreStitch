# LoreStitch Changelog

What's new in LoreStitch — written for writers, not for machines. This list also
powers the in-app **About → Changelog** viewer, so it stays with you even offline.

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
