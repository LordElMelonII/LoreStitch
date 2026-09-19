# Task 05 — URGENT: Mismatched / Malformed Delimiter Detection & Cleanup

> **Source**: User bug report 2026-09-19 — reopens the ROADMAP *"Asymmetric Delimiters & Unbalanced Wrappers"*
> sub-bullet (`<foo>…</bar>`, unclosed `<tag>`) that Task 01 deliberately left conservative.
> **Type**: Urgent defect fix + hardening (detection, previewed cleanup, regression tests)
> **Suggested agents**: `core-engine` (lead) → `ui-specialist` → `ts-reviewer` → `qa-auditor`
> **Status**: 🔴 **Planned — urgent; dispatch before 03/04.** Grounded against `develop` @ `c003bce`.

---

## 1. Objective

Recognize **wrapper-shaped but malformed** whole-content delimiters (mismatched pairs such as
`<test>…</universe>` / `<universe>…</test>`, orphan opening or closing tags) instead of silently
classifying them as `'none'`, and let the user clean them up through the existing previewed
delimiter flow — for one entry or the whole book — instead of nesting fresh wrappers around the
broken markup. No silent mutation: every change stays visible in the diff preview before apply,
preserving Task 01's "never silently delete" contract.

## 2. Confirmed defect (repro, `develop` @ `c003bce`)

**U1 — mismatched whole-content wrappers are invisible and get double-wrapped.**

- `src/app/core/models/delimiters.ts:38` — `TAG_RE` closes with the backreference `</\1>`, so the
  closing tag name must equal the opening name. `<test>\nlore\n</universe>` (either mismatch
  direction) fails all three regexes → `detectDelimiter` returns `'none'`.
- Consequences, all confirmed in the 2026-09-19 screenshots:
  1. **Entry editor badge is blind**: `entry-content-field.ts` `delimiterBadge` renders nothing,
     so the user has no signal the content is malformed.
  2. **Dialog nests wrappers**: `delimiter-dialog.ts` `resolveExpectedNames` only accepts a name
     from `isNamedWrapper(detected)` — nothing is detected, so `rewrapContent` treats the broken
     pair as payload and bakes a second wrapper around it, e.g.
     `<Universe>\n<test>\nlore\n</universe>\n</Universe>`. Delimiters are baked into
     `entry.content`, so this corruption is written straight into exported SillyTavern files.
- Same family, same fix: orphan opening (`<universe>\nlore`, no closer) and orphan closing
  (`lore\n</universe>`) tags, and unbalanced brackets (`[Name=\nlore` with no `]`). The 2026-09-19
  report is specifically the mismatched pair; the classifier must cover the family so the same
  class of bug cannot recur one variant later.

## 3. Design

### 3.1 Options considered

| Option | Verdict |
|--------|---------|
| **A. Auto-strip malformed wrappers inside `rewrapContent` defaults** | Rejected. Task 01 (defect D4, §7.2) pinned mismatched input as payload precisely so prose like `<note>x</note>` is never deleted by mistake. Widening the default would silently change behavior for every caller and reintroduce that risk. |
| **B. Dedicated "Remove malformed delimiters" button** (user proposal — one entry / every entry) | Workable, but as a standalone write path it either bypasses the dialog's diff/token preview or duplicates it, and adds a second destructive action to maintain and test. Kept as fallback if C's banner proves insufficient in review. |
| **C. Detect → surface → clean up through the existing previewed flow** (chosen) | A pure classifier recognizes malformed whole-content wrappers; the dialog previews replacing them with the chosen style (or removing them via `None`), row hints and a banner make the change explicit, and the entry-field badge warns outside the dialog. This delivers exactly the capability requested in B — "remove malformed delimiters, one entry or all" — through the flow that already has scope selection, per-entry diffs, and token deltas, with **no new write pathway**. |

Consistency note grounding C: since `d99e5eb` the dialog already treats any *well-formed*
whole-content wrapper as replaceable regardless of name (the accepted-detected-name rule in
`resolveExpectedNames`). Extending that same, diff-visible semantics to mismatched pairs is the
natural completion of that decision — a mismatched pair is strictly *less* likely to be innocent
prose than the well-formed `<p>x</p>` block the dialog already replaces today.

### 3.2 Behavioral contract for `delimiters.ts` (target state, all pure & total)

Additive API — `detectDelimiter`, `unwrapContent`, `rewrapContent`, and every Task-01-pinned
behavior stay byte-for-byte unchanged (malformed input still classifies as `'none'` there; the
dialog opts in explicitly):

```ts
export type MalformedWrapper =
  | { kind: 'mismatched'; openingName: string; closingName: string }
  | { kind: 'orphan-open'; name: string }   // '<foo>\npayload' — opener alone on the first line, no closer
  | { kind: 'orphan-close'; name: string }; // 'payload\n</foo>' — closer alone on the last line, no opener

/** Classifies a malformed whole-content wrapper, or null. */
export function detectMalformedWrapper(content: string, hints?: readonly string[]): MalformedWrapper | null;
/** Compact badge label, e.g. '<test> ? </universe>' or '<universe> ?'. */
export function malformedWrapperLabel(malformed: MalformedWrapper): string;
/** Removes one outer malformed shell; payload survives verbatim. Identity when nothing matches. */
export function stripMalformedWrapper(content: string): string;
```

Classification guards (false-positive protection — prose must never classify):

1. **Whole-content span only**, anchored exactly like `TAG_RE`: tolerant of leading/trailing
   whitespace and CRLF; tag names 1–80 chars, no `<>` or newlines inside.
2. **Non-blank payload** — a blank body never classifies (aligns with the Task-01 blank no-op
   invariant; no phantom artifacts, ever).
3. **`mismatched`**: opening `<A>` on the first line and closing `</B>` on the last, `A ≠ B`
   (case-insensitive), and both names survive `sanitizeDelimiterName` non-empty. Fires **without**
   hints (§3.1 consistency note).
4. **`orphan-open` / `orphan-close`**: require that the tag name **matches one of `hints`**
   (`delimiterNameMatches`, case-insensitive, sanitized) — an unmatched lone `<div>` in code-ish
   prose must stay payload. Both call sites pass the entry-derived name chain. Unclosed bracket
   `[Name=\n…` classifies as `orphan-open` under the same hint rule.
5. `stripMalformedWrapper` removes **one** outer shell, keeps the payload verbatim (no trim —
   Task-01 D2 lossless standard), and is idempotent (`strip ∘ strip === strip`).

### 3.3 Dialog & badge contract (UI)

Design guidance: `material-3` supplies tokens and component structure (it takes precedence);
`frontend-design` supplies copy and visual direction — active voice, sentence case, plain verbs,
states that say what happened and what to do next, one quiet emphasis point per surface, no
decorative chrome.

**`delimiter-dialog`** (`features/delimiters/`):

- `EntryPreview` gains `malformed: MalformedWrapper | null`. In `previews`, affected rows compute
  `next = rewrapContent(stripMalformedWrapper(current), style, resolveName(entry), expectedNames)` —
  malformed rows now count as `changed`, so the standard Apply (any style) replaces the broken
  pair; style `None` removes it. `apply()`'s write path needs no new branch.
- **Row chip + hint** (per affected row): tonal chip `mismatched` / `unclosed`; hint text
  "Will replace the mismatched `<test>` and `</universe>` delimiters" (style `None`:
  "Will remove …"), mirroring the existing `replacedDelimiter` hint at
  `delimiter-dialog.html:136-144`.
- **Banner** above `.preview-header` when any target in scope is malformed (insertion point:
  between `.example-card` and `.preview-header`, `delimiter-dialog.html:83-110`):
  - Copy (active voice, says exactly what happens, sentence case):
    *"N entries have malformed delimiters — mismatched or unclosed pairs such as
    `<test> … </universe>`. Applying a style replaces them; None removes them."*
  - M3 tokens only: `warning` icon, `--mat-sys-error-container` fill with
    `--mat-sys-on-error-container` text (data-integrity warning, static error roles), 12dp
    `--mat-sys-shape-corner-medium`, label-large title over body-medium body. Flat tonal
    container — no shadow elevation. No click action: the affordance remains the standard
    preview-verified Apply, so no new touch target is introduced.
  - Preview-header meta gains `· N malformed` alongside the existing counts.
- Mobile: banner renders inside the existing `app-compact-fullscreen-dialog` full-screen pane —
  fluid height, no fixed heights; rows keep ≥44px targets (already buttons).

**`entry-content-field`** badge (blind-spot fix): when `detectDelimiter` is `'none'` but
`detectMalformedWrapper(content, [entryDelimiterName(entry), entryDelimiterNameFromKey(entry)])`
fires, the hint (`entry-content-field.html:22-24`) shows `malformedWrapperLabel(...)` +
"· click the code button to fix", colored `--mat-sys-error` (M3 form-field error semantics);
tooltip: "Content has mismatched or unclosed delimiters — click to fix".

### 3.4 Test matrix

**Tier 1 — `delimiters.spec.ts` (pure, exhaustive):**

| Area | Required cases |
|------|----------------|
| Mismatched | `<test>\nlore\n</universe>` and reverse order; case-difference names (`<Test>` vs `</test>` → still mismatched); padded/CRLF variants; `>80`-char names → `null`; blank payload → `null`; well-formed `<b>x</b>` → `null` (stays `detectDelimiter` territory) |
| Orphans | `<universe>\nlore` fires only with a matching hint; without hints → `null`; lone `<div>` prose with non-matching hint → `null`; `lore\n</universe>` closer-only symmetric; unclosed `[Name=\nlore` bracket |
| Strip | payload byte-lossless (padding, CRLF, `<>[]=` payloads); one-shell-only; idempotent; `null` input → identity |
| U1 regression pin | `rewrapContent(stripMalformedWrapper('<test>\nlore\n</universe>'), 'tag', 'Universe') === '<Universe>\nlore\n</Universe>'` — single clean wrapper, zero nesting |
| Labels | `malformedWrapperLabel` for all three kinds |

**Tier 2 — `delimiter-dialog.spec.ts` + `entry-content-field.spec.ts`:** malformed rows flagged
and counted in the banner; apply tag → content contains exactly one wrapper pair; style `None` →
broken tags gone, payload intact; token delta reflects the swap; badge hint + tooltip render for
malformed content and stay empty for clean prose.

**Tier 3 — `e2e/delimiters.spec.ts` (extend):** seed an entry with `<test>\n…\n</universe>` →
open dialog → row shows the mismatched chip → apply tag → on-screen content shows exactly one
wrapper pair → export → assert wrapped `content` in the file → re-import (mirrors the existing
cycle test); one mobile-viewport (390×844) pass over the banner + apply.

## 4. Implementation Plan

| Phase | Files | Work |
|-------|-------|------|
| **P1 — Core classifier** (core-engine) | `src/app/core/models/delimiters.ts`, `delimiters.spec.ts` | §3.2 API + guards; full Tier-1 matrix; no changes to existing exported behavior |
| **P2 — Dialog & badge** (ui-specialist) | `delimiter-dialog.ts/.html/.scss/.model.ts`, `delimiter-dialog.spec.ts`, `entry-content-field.ts/.html/.scss`, `entry-content-field.spec.ts` | §3.3 previews/rows/banner/badge; M3 tokens, Signal-only, no `::ng-deep`; Tier-2 tests |
| **P3 — Review** (ts-reviewer) | all touched | Strict typing (discriminated `MalformedWrapper` exhaustiveness), lint |
| **P4 — E2E & coverage** (qa-auditor) | `e2e/delimiters.spec.ts` | §3.4 Tier 3 incl. export/import cycle + mobile viewport; coverage check |

Commits per phase, conventional format: `fix(delimiters): …`, `fix(delimiters-dialog): …` /
`feat(entry-editor): …`, `test(e2e): …`; completion lands a `docs(next_tasks): …` status commit.

## 5. Orchestration

Sequential, gated pipeline (urgent — preempts Tasks 03/04):

1. **`core-engine`** — P1. Skills: `typescript-advanced-types`. *Gate: `npm test` — delimiters
   suite green including the U1 regression pin; no existing delimiter test modified.*
2. **`ui-specialist`** — P2. Skills: `angular-developer`, `material-3`, `frontend-design`
   (§3.3 copy and visual direction). *Gate: `npm test` + `npm run build`.*
3. **`ts-reviewer`** — P3. *Gate: `npm run lint` clean, no new `any`/assertions.*
4. **`qa-auditor`** — P4. Skills: `playwright-cli`. *Gate: `npx playwright test delimiters`
   green on desktop + mobile projects.*

The orchestrator holds §3.2 as the acceptance spec. File ownership is disjoint from Tasks 03/04
(linter/regex sandbox) — no overlap except the shared README, which this planning commit updates.

## 6. Verification Gates

`npm run build` · `npm test` · `ng test --coverage` (no regression on `delimiters` /
`delimiter-dialog` / `entry-content-field` coverage) · `npx playwright test delimiters
round-trip` · `npm run lint`.

## 7. Risks & Open Questions

1. **Mismatched-without-hints false positive** (e.g. whole-content prose `<b>x</i>`): accepted,
   consistent with the shipped accepted-detected-name rule for well-formed wrappers; every change
   is diff-visible before apply. Tests pin the stance. Revisit only if a real-world report lands.
2. **Repair-vs-remove**: offering "fix the pair to `<test>…</test>`" (reconcile names) is a nicer
   end-state than strip+rewrap but adds a second transformation path; deferred to a follow-up or
   Task 03's linter, which should adopt `detectMalformedWrapper` as a lint rule.
3. **Orphan hint source**: the badge and dialog both use the entry-derived name chain; entries
   whose names share nothing with the orphan tag stay unflagged (by design — see §3.2.4).
