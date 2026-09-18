# Task 01 — Delimiters Testing & Edge Cases

> **Source**: `ROADMAP.md` → MEDIUM PRIORITY → *"Delimiters testing and edge cases"*
> **Type**: Hardening + test coverage (fix confirmed defects, pin all edge-case behavior with tests)
> **Suggested agents**: `core-engine` (lead) → `ui-specialist` → `qa-auditor` → `ts-reviewer`
> **Status**: ✅ **Completed** (2026-09-18) — P1 model hardening `a5f4c34`, P2 dialog previews/token deltas `1f147b3`,
> P3 E2E suite `5271218`; the §7.2 open question (foreign-named wrappers must be detected and replaced regardless of
> name) resolved in `d99e5eb`. All verification gates green (build, unit, coverage, Playwright delimiters, lint).

---

## 1. Objective

Make delimiter wrap/strip/rewrap operations provably safe across every malformed, asymmetric, empty, and hostile input described in the ROADMAP, and lock the behavior in with a three-tier test suite (pure model → dialog component → Playwright E2E). Delimiters are **baked into `entry.content`** at apply time (there is no dynamic-insertion pathway), so any corruption here is written directly into exported SillyTavern files.

## 2. Current State (code audit, `develop` @ `4120bb9`)

### 2.1 Existing implementation

`src/app/core/models/delimiters.ts` — pure module, styles are `'tag' | 'bracket' | 'separator' | 'none'` only (no Markdown-header or YAML style exists):

```ts
export type DelimiterStyle = 'tag' | 'bracket' | 'separator' | 'none';
export function detectDelimiter(content: string): DetectedDelimiter;
export function wrapContent(content: string, style: Exclude<DelimiterStyle, 'none'>, name = ''): string;
export function unwrapContent(content: string): string;
export function rewrapContent(content: string, style: DelimiterStyle, name = ''): string;
export function entryDelimiterName(entry: {...}): string;        // comment → name → first key → 'entry'
export function entryDelimiterNameFromKey(entry): string;
export function delimiterLabel(detected: DetectedDelimiter): string;
```

- Idempotency today = `rewrapContent` = `wrapContent(unwrapContent(content), …)`: same-style re-apply is a no-op **only when** the wrapper was produced by `wrapContent`.
- Detection regexes (`TAG_RE` backreference `</\1>`, `BRACKET_RE`, `SEPARATOR_RE`) tolerate CRLF and surrounding spaces/tabs; mismatched (`<foo>…</bar>`) and unclosed tags are *not* detected → fall through to `'none'`.
- `wrapContent` trims the body; `unwrapContent` trims the inner text.
- Entry-derived names are sanitized (`cleanDelimiterName`, private): strips `[<>=[\]\n\r]`, collapses whitespace, caps 80 chars.

`src/app/features/delimiters/delimiter-dialog.ts` — Signal Forms dialog; computes per-target previews (`rewrapContent`), renders diffs via shared `DiffViewer`, writes only changed ids through `workspace.updateManyEntries(ids, entry => ({ content: rewrapContent(...) }))`. Existing spec: 9 tests (double-wrap prevention, rewrap, None-strip, scope, naming modes, no-op apply).

`src/app/core/services/token-estimator.ts` — pure `estimateTokens(text)` (CJK 1/char + `ceil(other/4)`), `estimateEntryTokens(entry)` = content only. Delimiter overhead is counted **only implicitly** because it is baked into content. The dialog preview shows **no token delta**.

### 2.2 Coverage gaps

- `e2e/delimiters.spec.ts` — **does not exist** (explicitly required by ROADMAP).
- `e2e/round-trip.spec.ts` — no delimiter operations at all.

### 2.3 Confirmed defects (found during this audit — to fix)

| # | Defect | Repro | ROADMAP area |
|---|--------|-------|--------------|
| D1 | Separator style is **not idempotent** on bare `---` | `rewrapContent('---', 'separator')` → `'---\n\n---'` (unwrap detects `'none'` because `SEPARATOR_RE` needs ≥1 char before `\n---`, then wrap appends a second separator) | Idempotent wrap & strip |
| D2 | **Whitespace loss**: `wrapContent` trims body, `unwrapContent` trims inner text → `unwrap(wrap(x)) !== x` | `unwrapContent(wrapContent('  hi  ', 'tag'))` → `'hi'` | Idempotency / lossless round-trip |
| D3 | Typed **fixed name is not sanitized** in the dialog (only `.trim()`), so `<`, `=`, `]`, `]` in a name produce malformed wrappers | Type `a<b` as fixed name + tag style → `<a<b>\n…` | Special characters & escaping |
| D4 | **Mismatched/unclosed tags are double-wrapped**: `<foo>x</bar>` is undetected, so rewrap nests a new wrapper *around* the malformed markup; None-strip false-positively deletes legitimate prose that merely *looks* wrapped (e.g. prose `<note>x</note>`, a trailing scene-break `---`) | `rewrapContent('<foo>x</bar>', 'tag')` → `<entry>\n<foo>x</bar>\n</entry>` | Asymmetric delimiters / nested collisions |
| D5 | **Empty payloads emit phantom artifacts** | `wrapContent('', 'tag')` → `<entry>\n\n</entry>`; separator-empty → `'---'` (which then triggers D1 on re-apply) | Empty & whitespace-only payloads |

## 3. Design

### 3.1 Scope decision

The ROADMAP's "Why" mentions Markdown headers and YAML frontmatter as *examples of delimiter styles in the wild*. The implemented model supports tag/bracket/separator/none only, and the ROADMAP "Where" lists **only existing files** — so this task **hardens and tests the existing three styles**; Markdown-header content is treated as ordinary payload under the "nested collisions" rules (must never be falsely split/stripped). Adding new styles is explicitly **out of scope** (candidate LOW-priority follow-up).

### 3.2 Behavioral contract for `delimiters.ts` (target state)

1. **Blank-payload no-op** (fixes D5): `wrapContent` / `rewrapContent` return the trimmed input unchanged for empty or whitespace-only bodies, for **every** style. No phantom wrappers, no bare `'---'` emission → also resolves D1's accumulation chain.
2. **Lossless inner text** (fixes D2): `unwrapContent(wrapContent(x, style, name)) === x` — the wrapper's own structural newlines are consumed, the payload is captured verbatim (adjust `TAG_RE`/`BRACKET_RE` capture groups; stop trimming in both directions). `rewrapContent` on an unrecognized string remains `wrap(content)` (additive, never truncating).
3. **Exported sanitizer** (fixes D3): rename/private→export `sanitizeDelimiterName(name: string): string` and apply it to the dialog's typed fixed name, with a **live resolved-name preview** in the form (never silently rewrite the field — show "will be applied as `X`").
4. **Name-matched stripping** (fixes D4, decision required — see §7): extend `unwrapContent(content, expectedName?)` so tag/bracket stripping only removes a wrapper whose **name matches the resolved entry name** (case-insensitive) when `expectedName` is provided. The dialog always provides it. Bare `unwrapContent(content)` keeps current behavior for the detection badge. Separator stripping stays conservative (pinned by tests as an inherent ambiguity, surfaced by the existing diff preview).
5. **Totality**: all functions remain pure, total (no throws) — malformed inputs degrade to identity/no-op, never truncate.

### 3.3 Token-counter synchronization

- Add a **token delta** to the dialog: per-entry `estimateTokens(next) − estimateTokens(current)` on each preview row and a `Σ` total in the dialog header (`+N` / `−N` / `=` styling via `formatTokenCount`).
- Unit-test the accounting fact explicitly: `estimateTokens(wrapContent(x)) − estimateTokens(x)` equals the wrapper overhead, and `computeTokenFootprint` (always-active meter) reflects baked delimiters — documenting that dynamic insertion does not exist and the estimator is correct for the baked pathway.

### 3.4 Test matrix (maps 1:1 to the seven ROADMAP bullets)

**Tier 1 — `src/app/core/models/delimiters.spec.ts` (pure, exhaustive):**

| Area | Required cases |
|------|----------------|
| Idempotency | `rewrap∘rewrap` identity per style; re-apply on already-wrapped (incl. CRLF + padded variants); strip of unwrapped = identity; **D1 regression** `rewrapContent('---','separator') === '---'` |
| Asymmetric / unbalanced | bracket `[Name=\n…]` unwrap verbatim; suffix-only `---`; mismatched `<foo>…</bar>` and unclosed `<tag>` pinned as `'none'` + rewrap never truncates inner text |
| Empty / whitespace | `''`, `'   '`, `'\n'`, comment-only bodies → no-op, no artifacts, all styles |
| Special characters | names/payloads with `<>[]=\n\r\t`, quotes, regex metachars `*+?|{}`, Unicode/emoji/CJK; `sanitizeDelimiterName` table-driven suite; CRLF content through wrap→unwrap |
| Nested collisions | payload *starting/ending* with wrapper-syntax prose (`<note>x</note>`, trailing `---`, `[x=]` inside) — pinned per §3.2.4 (with and without `expectedName`) |
| Token sync | §3.3 assertions against `token-estimator.ts` |
| Round-trip | `wrap → characterBookToStNative → JSON.parse/stringify → stNativeToCharacterBook → unwrap === original`, for both v1 and v2 native shapes; unknown vendor keys in `extensions` survive (lossless invariant) |

**Tier 2 — `delimiter-dialog.spec.ts` additions:** sanitized fixed-name preview + apply; token-delta rendering; blank entries shown as *unchanged* and excluded from writes; all-blank book → no-op apply path; name-matched strip behavior through the real form flow.

**Tier 3 — new `e2e/delimiters.spec.ts`:**
- Open dialog from entry content field → apply tag style to **all** entries → snackbar + content updated.
- **Cycle test**: apply tag → export World Info JSON → assert wrapped `content` in file → re-import → dialog → style `none` → apply → export → byte-compare entry content against original fixture (uses `e2e/` import/export helpers, mirroring `round-trip.spec.ts`).
- Regression fixture: entry whose content ends with a literal `---` scene break survives a tag wrap/strip cycle untouched.
- Mobile viewport (390×844): full-screen pane + **Apply performs the transformation** (extends the existing `ui-responsiveness.spec.ts` layout-only check).
- Extend `e2e/round-trip.spec.ts` with one wrapped-content survival assertion (ROADMAP lists it under "Where").

## 4. Implementation Plan

| Phase | Files | Work |
|-------|-------|------|
| **P1 — Model hardening** (core-engine) | `src/app/core/models/delimiters.ts`, `delimiters.spec.ts` | Implement §3.2 contract (blank no-op, verbatim capture, exported `sanitizeDelimiterName`, optional `expectedName`); port/extend the full Tier-1 matrix; every existing test that encodes the old trim behavior is updated **in the same commit** as the behavior change |
| **P2 — Dialog updates** (ui-specialist) | `src/app/features/delimiters/delimiter-dialog.ts/.html/.scss/.model.ts`, `delimiter-dialog.spec.ts` | Sanitized-name preview, token delta (per-row + total), blank-target UX, pass `expectedName` into rewrap; Tier-2 tests |
| **P3 — E2E** (qa-auditor) | `e2e/delimiters.spec.ts`, `e2e/round-trip.spec.ts` | Tier-3 scenarios incl. export/import cycle + mobile viewport |
| **P4 — Review** (ts-reviewer) | all touched | Strict-typing/signature review, lint pass |

## 5. Orchestration

Sequential pipeline (each phase gated on the previous):

1. **`core-engine`** — Phase 1. Skills: `typescript-advanced-types`. Deliverable: hardened pure module + green exhaustive unit suite. *Gate: `npm test` (delimiters + token-estimator + roundtrip specs green).*
2. **`ui-specialist`** — Phase 2. Skills: `angular-developer`, `material-3`. Constraint: Signal Forms only, M3 tokens, no `::ng-deep`. *Gate: `npm test` + `npm run build`.*
3. **`qa-auditor`** — Phase 3. Skills: `playwright-cli`. Runs the new E2E against the dev server, verifies coverage thresholds (`ng test --coverage`). *Gate: `npx playwright test delimiters round-trip` green on desktop + mobile projects.*
4. **`ts-reviewer`** — Phase 4 cross-cutting review; *Gate: `npm run lint` clean, no new `any`/assertions.*

Orchestrator (main agent) holds the §3.2 contract as the acceptance spec and arbitrates the §7 open questions before Phase 1 starts.

## 6. Verification Gates

`npm run build` · `npm test` · `ng test --coverage` (no regression on `delimiters`/`token-estimator`/`delimiter-dialog` coverage) · `npx playwright test delimiters round-trip ui-responsiveness` · `npm run lint`.

## 7. Risks & Open Questions

1. **Whitespace contract migration** (D2): making wrap/unwrap byte-lossless changes visible output for entries with padded content. Mitigation: single atomic commit (behavior + updated tests), dialog diff preview already shows users exactly what changes before apply.
2. **Name-matched stripping** (D4): if an entry was wrapped under an *old* name and the entry has since been renamed, strict name matching would refuse to strip it. Proposed resolution: match `expectedName` **or** the entry-derived fallbacks (`entryDelimiterName` chain); anything else still shows in the preview diff as "not recognized — applying will add a new wrapper". Decide at Phase-1 kickoff.
3. **Trailing `---` ambiguity**: a thematic scene break is indistinguishable from a separator wrapper. Accepted residual risk (documented + preview-diff surfaced); tests pin the chosen behavior.
4. **Token estimator precision**: `ceil(chars/4)` is heuristic; the delta display must be labeled as an estimate to match the existing topbar meter's framing.
