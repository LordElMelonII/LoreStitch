# example_card/

Reference lorebooks used as e2e/unit fixtures: the real-world Fuyuki lorebook (large, exotic vendor fields — the lossless round-trip stress test), the small `Example test lorebook.json`, `linter-demo.lorebook.json` (seeded with lint findings), and the character-card fixtures `example_card.json` / `example_card.png` (a `chara_card_v3` card and its PNG, each carrying the embedded book for the card round-trip suites).

**Hints**

- Changes here can pin test behavior — grep `e2e/` and `**/*.spec.ts` before editing.
