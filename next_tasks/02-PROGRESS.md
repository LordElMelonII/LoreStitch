# Task 02 — Mobile Ergonomics: Progress & Resume Plan

> **Status: ✅ TASK COMPLETE (2026-09-18).** All phases landed: P1–P5, the two session-2 critical fixes (bottom bar replaces the FAB; nested-menu touch flash), P6 e2e expansion (full 3-project suite green: 143 passed / 0 failed with documented gating, then re-verified after every later commit), the two drawer bugs the audit surfaced (fixed in-app, `cf0bd94`), and the P7 review gate (`445c43a`; all charter categories clean, one dedup fix). Final gates at HEAD: build ✅, 640 unit tests ✅, lint ✅, full playwright ✅ (last full run on `cf0bd94`'s tree; `445c43a` is behavior-identical and re-gated via unit+lint+build).
>
> Commit chain: `4eef3c1` P1 viewport · `6aaf593` P2 overlay service · `5995db5` P3 sheets · `be6a6e4`/`92ca652` P4+P5 (FAB era, superseded) · `2fa5535` nested-menu touch fix · `2818474` bottom bar · `9cd7f6e` label polish · `54930a4` e2e guardrails · `cf0bd94` drawer focus/scroll fixes · `445c43a` review dedup.
>
> Source plan: [`./02-mobile-ergonomics.md`](./02-mobile-ergonomics.md) (§3.3 amended) · Personas: `.agents/*.md`

---

## 0. Session 2 — critical fixes from real-device feedback (all committed)

User tested the P4 FAB build on a real phone and reported two critical issues; both fixed, verified, and committed:

| Commit | Fix |
|---|---|
| `2fa5535` | **Nested menus flashed open-then-closed on touch** (More menu → Export/Theme). Upstream Material bug (user reproduced it on the Material docs example): the tap's emulated `mouseenter` opens the child menu mid-gesture and the tap's remaining emulated events close it / land on it. New `TouchSafeNestedMenuTrigger` directive (`shared/directives/`) suppresses only the emulated hover for in-flight touches via document-level capture listeners; the tap's click opens the submenu once, a second tap toggles closed. Desktop hover/click/keyboard unchanged. Touch-emulated e2e regression spec `e2e/nested-menu-touch.spec.ts` (6/6 across all three projects). |
| `2818474` | **FAB covered the accordion expand toggle** → FAB deleted, replaced by `mobile-bottom-bar/`: M3 bottom action bar mounted as a normal flex child of app-root (topbar / workspace / bar — nothing can ever overlap editor content), safe-area padded, hidden while overlays/drawers are open. Five labeled actions: New entry, Search, Export (opens the shared five-format menu upward via `yPosition="above"`), Batch edit, **History (moved off the mobile topbar)**. Export logic single-homed in `ProjectActionsService`; empty-selection Batch edit now shows a snackbar hint. |
| `9cd7f6e` | **Bottom-bar label collision** ("New entrySearch & replace" at 390px): visible label shortened to M3 navigation-bar style ("Search") with `aria-label="Search & replace"` preserved, and labels clamp inside items with ellipsis. |

Browser verification (control-browser skill, vision): mobile 390×844 — bar correct incl. light theme, Export menu opens upward with all five entries, History opens the over-drawer and the bar hides while it is open, New entry creates (tabs update; sidebar list header count correct), Batch-without-selection shows the snackbar, topbar decluttered, accordion chevron unobstructed. Desktop 1280×800 — no bar, full topbar with history button + badge restored, More→Export submenu opens and STAYS open with the mouse, light theme clean.

**P4 note for reviewers:** `MobileBarAction` has 4 members (no `'export'` — the bar's Export is an in-component menu trigger over the shared service, nothing routes through the shell for it). The bar's Export trigger deliberately does NOT carry `appTouchSafeNestedMenuTrigger` (it is a standalone trigger, not a nested `mat-menu-item`).

---

## 1. Commit ledger (all on `feature/02-mobile-ui`, in order)

| Commit | Phase | Content |
|---|---|---|
| `051c9d1` | baseline | `docs(next_tasks): add medium-priority plans for tasks 02-04` (un-ignores `next_tasks/`, adds plans 02/03/04, README + AGENTS.md updates) |
| `4eef3c1` | **P1** | `refactor(layout): consolidate viewport state into LayoutService` |
| `6aaf593` | **P2** | `feat(overlay): extract reusable responsive-overlay opener service` |
| `5995db5` | **P3** | `feat(overlays): render batch, merge and export panes as bottom sheets on mobile` |
| `be6a6e4` | **P4** | `feat(shell): add collapsible mobile FAB for core entry actions` |
| `92ca652` | **P5** | `feat(a11y): standardize touch targets to 44px floor / 48px mobile` |

Working tree at interruption: **clean** (all phase work committed; screenshots/artifacts live outside the repo under `C:\Users\Cristian\.zcode\cli\artifacts\`).

Gates passed after each phase pair (details in §3): `npm run build` ✅, `npm test` ✅ (610 → 613 → final tree full suite green), `npm run lint` ✅.

---

## 2. What was done, per phase

### Re-grounding (before P1)
Read-only Explore audit at HEAD `109061d` confirmed the plan's "Current State" was still accurate. Key verified facts (needed by later phases):
- Dialog inventory: only About was dual-ref; Batch/Merge/Export/TokenInspector/SearchReplace all required-`MatDialogRef`, `app-compact-fullscreen-dialog`.
- 4 duplicated `BreakpointObserver` consumers: `app.ts`, `topbar.ts`, `project-actions.service.ts` (`isMatched`), `entry-options-accordion.ts` (no spec existed).
- `@Service()` is Angular's own decorator from `@angular/core` (root-provided, no providers arrays) — the repo's DI registration pattern.
- `MatBottomSheetRef<T, R>` typings at `node_modules/@angular/material/types/bottom-sheet.d.ts`; `MatBottomSheet` has **no global afterOpened stream** (per-ref only).
- `src/styles.scss` holds ALL theming (two `mat.theme` includes, azure-blue light / cyan-orange dark) + touch-target block at ~488-507 + About sheet class ~188-210.
- Playwright: 3 projects (`desktop-chrome`, `mobile-chrome` Pixel 7, `mobile-safari` iPhone 14); only `about-dialog.spec.ts` had viewport gating.
- **DRIFT found**: `ui-responsiveness.spec.ts` gained Task-01 delimiter-dialog assertions (lines ~271-308) + a virtual-list fill test (~333-386).

### P1 — Viewport consolidation (ui-specialist)
- `layout.service.ts`: `viewport = toSignal(BreakpointObserver.observe([mobile, tablet, desktop]).pipe(map(...)), { initialValue: 'desktop' })` (mapping ported verbatim from app.ts), `isMobile`/`isDesktop` computeds; `BreakpointObserver` now injected **only** here (ts-reviewer enforcement point).
- `breakpoints.ts`: header doc codifies the two-system rule — **<768px = shell/sheet breakpoint; ≤599px = MD3 compact-dialog window**.
- All 4 consumers migrated (app.ts, topbar.ts, project-actions.service.ts, entry-options-accordion.ts). Signal-alias technique (`protected readonly viewport = this.layout.viewport`) avoided template churn.
- New specs: `layout.service.spec.ts` (4 tests), `entry-options-accordion.spec.ts` (2 tests).
- **Semantic nuance**: topbar `isDesktop` reads `true` on first tick now (CDK `observe()` emits synchronously; no-match falls through to desktop). One topbar spec restructured to pin an explicit mobile viewport first.
- Gates: build ✅, `npm test` 604 ✅, lint ✅, `npx playwright test e2e/ui-responsiveness.spec.ts` → **113 passed / 1 failed**, failure proven **pre-existing** (same failure on clean tree): `mobile-safari › desktop-1920x1080 › long entry names …` — a desktop-viewport describe running under a mobile project (gating gap, assigned to P6).

### P2 — ResponsiveOverlayService (ui-specialist)
- New `src/app/shared/services/responsive-overlay.service.ts`:
  ```ts
  openResponsive<T, D = unknown, R = unknown>(component: ComponentType<T>, config: {
    data?: D;                    // canonical payload — ONLY source (dialog/sheetConfig data keys are deleted)
    dialog: MatDialogConfig<D>;
    sheetPanelClass?: string;    // omit => dialog-only on every viewport
    sheetConfig?: Partial<MatBottomSheetConfig<D>>;  // extras; canonical fields win (spread order { ...sheetConfig, panelClass, data })
  }): MatDialogRef<T, R> | MatBottomSheetRef<T, R>;
  ```
  Branch: `sheetPanelClass && layout.isMobile()` → bottomSheet, else dialog. Parity-critical detail: the `data` key is set **only when a payload exists** (Material's `{...defaults, ...config}` merge would let explicit `data: undefined` clobber the `null` default).
- `topbar.openAbout()` migrated; `MatBottomSheet` injection/module removed from topbar; `MatDialog` kept (still used by openSearch). 7 service spec tests, 100% coverage on the service.
- Gates: build ✅, `npm test` 610 ✅, lint ✅, `npx playwright test e2e/about-dialog.spec.ts` → 9 passed / 12 skipped (zero visual change proven).

### P3 — Dialog→sheet conversions (ui-specialist)
- **BatchOperationsDialog, MergeResolverDialog, ExportSelectedDialog** all converted to the About dual-ref shape: optional `MatDialogRef<X, R>` + `MatBottomSheetRef<X, R>`, data via `MAT_DIALOG_DATA ?? MAT_BOTTOM_SHEET_DATA` fallback, `close(result?)` routes to whichever ref exists, self-painted header (title keeps `mat-dialog-title` for dialog aria) / `.pane-body` scroll container / pinned `.pane-footer`. All functional logic untouched.
- Callers route through `openResponsive(...)`; desktop configs **byte-identical** to before. Merge keeps `mode: layout.isMobile() ? 'unified' : 'split'`. Union ref handled via file-local `paneResult<R>()` helper using `ref instanceof MatDialogRef` (safe: concrete classes, never wrapped).
- `styles.scss` sheet classes: `.app-batch-sheet` 88dvh, `.app-merge-sheet` 92dvh, `.app-export-sheet` 88dvh — all `padding: 0` + explicit `border-radius: 28px 28px 0 0` (Material only applies its top radius from the `medium` viewport class up; phone sheets are square without it).
- Exposed for P4: `EntryList.openBatchOperations()` → public; `ProjectActionsService.createEntry()` added (thin wrapper); `exportSelectedEntries()` / `importMergeFromPicker()` already public.
- Desktop parity: self-painted header/body/footer replicate Material's own dialog metrics read from `fesm2022/dialog.mjs` (padding 20/24/12px, `--mat-sys-headline-small`, body max-height 65vh, footer min-height 52px). Only intentional delta: added close icon button (~16px taller header). The ≤599px media blocks in batch/export SCSS were KEPT — they still match inside sheets at ≤599px.
- Gates: build ✅, `npm test` 613 ✅, lint ✅. `npx playwright test e2e/batch-and-tokens.spec.ts` → **desktop all pass; 3 mobile failures**, all at the row-**selection** stage (before any dialog opens) and proven **pre-existing** (same on clean tree): `.row-select` not visible because the entries sidenav is `over`/off-canvas at phone width and the spec helper never opens it. Root-caused, owned by P6 (§5.2).

### P4 — Mobile FAB (ui-specialist) — parallel with P5 (disjoint file sets)
- New `src/app/features/shell/mobile-fab/` (ts/html/scss/spec, standalone OnPush, presentational): inputs `overlayOpen`, `drawerOpen`; output `action: 'new-entry' | 'search-replace' | 'export' | 'batch'`. Visible = mobile viewport + project open + no overlay. Effect folds the stack when drawer/overlay/viewport/project state says so.
- Collapsed: 56px `matFab` primary-container, `menu`⇄`close` morph, `aria-expanded`/`aria-controls`/`aria-label="Quick actions"`. Expanded: 4 rows (New entry `post_add`, Search & replace `find_replace`, Export entries `call_split`, Batch edit `checklist`) = secondary-container `matMiniFab` + `--mat-sys-surface-container-high` label pill, `aria-labelledby`, `[attr.inert]` when collapsed. 200ms M3 emphasized easing, 20ms row stagger, `prefers-reduced-motion` → 1ms.
- **Placement deviation (justified)**: `mat-sidenav-container` projects only sidenav/content children (verified in `fesm2022/sidenav.mjs`), so the FAB mounts as the container's **sibling in app-root**, `position: fixed`, `inset-inline-end: 16px; inset-block-end: calc(16px + env(safe-area-inset-bottom))`. z-index 5 (above drawer stack z=3 in container's context, below CDK overlay z=1000) — commented in `mobile-fab.scss`. Also doubly safe: FAB hides while any overlay is open.
- Wiring: `App.runFabAction()` → `ProjectActionsService.createEntry()` / `viewChild(Topbar).openSearch()` (made public; config untouched — single source of truth) / `exportSelectedEntries()` / `viewChild(EntryList).openBatchOperations()` (`?.` guard — EntryList is `@defer`red). App feeds `[overlayOpen]="overlays.anyOverlayOpen()"`, `[drawerOpen]="leftOpened() || rightOpened()"`.
- `responsive-overlay.service.ts` extended: `openDialogCount`/`openSheetCount` signals + `anyOverlayOpen` computed. Dialogs counted app-wide via `MatDialog.afterOpened`/`afterAllClosed`; sheets via open-increment / `afterDismissed`-decrement (this service is the only sheet opener). `activeEntryId` edge: SearchReplaceDialog defaults to "All entries" scope, null-tolerant — no special-casing needed.
- Targeted verification: 48 tests across mobile-fab/app/topbar/overlay-service specs ✅, lint ✅ (full gates run after both parallel phases).

### P5 — Touch targets (ui-specialist) — parallel with P4
- New `src/app/shared/constants/touch-targets.ts`: `TOUCH_TARGET_MIN = 44`, `TOUCH_TARGET_MOBILE = 48`. `styles.scss:root` gets `--touch-target-min: 44px` / `--touch-target-mobile: 48px`; the ≤767px global block now consumes the vars. Reason holdouts existed: **scoped selectors outrank the global rule**, so per-component files must restate 48px.
- Fixes: about links 44→var(+mobile 48); `.tag-chip` same; ghost row-action buttons 40px→44 floor via `--mat-icon-button-state-layer-size` (+48 mobile); token-inspector rows 44→var(+48); accordion `.control-strip` 48→var; batch `.op-row` var substitution.
- Export dialog: rows stay 44 (**virtual-scroll constraint** — uniform `itemSize="44"`, 48 would overlap neighbor rows; meets universal floor; bonus: clamped `--mat-checkbox-touch-target-size` fixed a pre-existing 2px spill into adjacent rows); previously-unstyled `.row-toggle` now stretches the full 44px row (`display:flex` makes the old dead sibling flex rules live).
- Deliberate exceptions: inline prose links in About OSS tab (WCAG 2.5.8 inline exception); desktop M3 defaults (40px icon buttons/32px chips) — existing documented decision; a desktop-wide 44 floor would belong in the global block (flagged, not done).
- Verification: lint ✅; all 7 SCSS compile via `npx sass` (no stylelint configured).

---

## 3. Verification gate status (per `next_tasks/README.md` conventions)

| Gate | Status |
|---|---|
| `npm run build` | ✅ after P1, P2, P3, and on final P4+P5 tree |
| `npm test` (Vitest + coverage tables; `ng test` reports coverage by default here) | ✅ 604 → 610 → 613 tests, all green at every phase |
| `ng test --coverage` | ✅ equivalent — `npm test` emits coverage; new files at 100% (layout.service, responsive-overlay.service, mobile-fab targeted run 48/48) |
| `npm run lint` | ✅ after every phase |
| `npx playwright test` (FULL suite, all 3 projects) | ⚠️ **NOT yet run on the final tree** — only per-phase subsets (`ui-responsiveness` after P1, `about-dialog` after P2, `batch-and-tokens` after P3). Full run is part of P6. Two known **pre-existing** mobile failures (see §5.1/§5.2) will fail before P6 fixes them. |
| Browser UI verification (control-browser skill) | 🔄 **in progress** — see §4 |

---

## 4. Browser UI verification — where it stopped (RESUME HERE)

**Environment state at interruption:**
- Angular dev server was **stopped after the interruption** (was `npm start -- --port 4301`). On resume: start it again in the background (`npm start -- --port 4301`, ~10-30s to compile) before any browser work.
- ZCode in-app browser (IAB) tab `iab-tab:ee359e3b-5d77-4a9a-82bf-a292198f512a` last pointed at `http://127.0.0.1:4301/`, viewport 1280×800, app state: project **"Mobile UI Review"** with 3 entries ("Grail Ritual", "Fuyuki City", "Servant Classes" — one open in editor tabs), persisted in localStorage. After restarting the server, `tab.reload()` on the still-open tab should restore the project; if the tab is gone, just create a new one (or recreate the project — 1 min via the §4.1 click pattern). Tabs persist for the ZCode process lifetime; re-list with `browser.tabs.list()` and `tabs.get(id)` per the control-browser skill (fresh kernel every call).
- Screenshots dir: `C:\Users\Cristian\.zcode\cli\artifacts\sess_bdd6222d-6df8-47fc-a65f-8c011d30044b\ui-review\` (currently empty — the first two captures were cancelled).

**Hard-won operational knowledge (do not re-derive):**
1. **Playwright-locator `.click()` times out on this app** even when `count()===1` and `isVisible()===true` (likely IAB input-pipeline quirk). Working pattern (used successfully for: New project dialog, project creation, 3 entry creations):
   ```js
   const rect = await tab.playwright.evaluate(`(() => {
     const b = [...document.querySelectorAll('button')].find(el => (el.getAttribute('aria-label')||'') === 'LABEL');
     if (!b) return null; const r = b.getBoundingClientRect();
     return { x: r.x + r.width/2, y: r.y + r.height/2 };
   })()`);
   await tab.cua.click({ x: Math.round(rect.x), y: Math.round(rect.y) });
   ```
   `.fill()` on textboxes works normally via locators.
2. **Screenshot size limit**: viewport-clip captures ≤ 1280×800 succeed; **1440×900 and 1440-wide clips reliably time out** (30s). Use `tab.setViewportSize({width:1280, height:800})` + clip 1280×800. Small clips (~400×300) are fast.
3. Mobile-viewport testing = `await tab.setViewportSize({ width: 390, height: 844 })` (LayoutService reacts live — this is also a good manual check of the P1 refactor).

**Remaining verification checklist (the actual plan §3.x behaviors to eyeball in the browser):**
- [ ] Desktop 1280×800: editor shell + About **dialog** (already navigated; capture 01/02 were cancelled).
- [ ] Resize to 390×844: **FAB appears** bottom-end above safe-area inset; expand → 4 labeled actions; New Entry creates + focuses; Escape collapses; FAB hides while a sheet is open, reappears on close.
- [ ] Mobile: About / **Batch** (needs rows selected via the entries drawer) / Merge / Export open as **bottom sheets** (`.mat-bottom-sheet-container` with the new panel classes), pinned footers, rounded top corners.
- [ ] Merge sheet: `unified` mode forced on mobile; rows own the scroll; actions pinned.
- [ ] Export sheet: virtual-scroll list still measures (flex-height chain) — scroll + select works.
- [ ] Touch targets spot-check: tag chips, ghost row actions, accordion strip ≥48px at 390px width.
- [ ] Desktop ≥768: same dialogs still render as **centered dialogs identical to pre-task** (regression check).
- [ ] Light **and** dark theme quick pass (token-only styling should hold; toggle via Theme menu).
- [ ] Optional: hand final screenshots to the `judge` agent for the visual acceptance pass (it accepts PNG paths; captures must be ≤1280×800 per limitation above).

---

## 5. Open work (in execution order)

### 5.1 P6 — E2E mobile expansion (`qa-auditor`) — plan §3.5
Files: `e2e/ui-responsiveness.spec.ts`, `e2e/batch-and-tokens.spec.ts`, `e2e/about-dialog.spec.ts`, per-dialog specs.
1. Bottom-sheet assertions on 390/412 + mobile projects: Batch/Merge/Export/About open `.mat-bottom-sheet-container`, actions in viewport, no horizontal overflow, Escape dismisses.
2. FAB flows: visible mobile / absent ≥768; expand → 4 actions ≥44px; New Entry creates + focuses name field; collapses on Escape/overlay-open.
3. Generalized touch-target guard: extend the topbar-only 48px check to entry rows, accordion headers, batch bar, FAB actions.
4. Keep whole-DOM overflow poll; add sheet scrollability assertions (`scrollHeight > clientHeight` ⇒ scrollable with actions pinned).
5. Project gating: add `test.skip(({ viewport }) => viewport.width >= 768)`-style gates mirroring `about-dialog.spec.ts` so mobile projects run mobile-relevant suites (bounds CI time).
6. **Fix the two pre-existing mobile failures** (blockers for a green full run):
   - `batch-and-tokens.spec.ts` (mobile-chrome + mobile-safari, 3 tests): `selectFirstTwoRows` helper must first open the entries drawer (hamburger "Toggle entries panel", `over` mode on mobile) before clicking `.row-select`; the desktop flow opens with the drawer docked which is why desktop passes.
   - `ui-responsiveness.spec.ts` `mobile-safari › desktop-1920x1080 › long entry names …`: gate the desktop-viewport describes against mobile projects (same pattern as item 5) — the test loops VIEWPORTS itself, so the skip must be per-project or the loop's desktop legs must be project-gated.
7. Then run the **full** `npx playwright test` (all 3 projects) as the P6 gate; also `npm run typecheck:e2e` if the repo's tsconfig.e2e is wired into CI (`npm run typecheck:e2e` script exists).
8. Commit: `test(e2e): mobile sheet/fab/touch-target guardrails` (+ any app fix if a real bug surfaces).

### 5.2 P7 — Review gate (`ts-reviewer`) — plan §4 P7
Scope: all touched files (see `git diff 109061d..HEAD`). Enforce: `BreakpointObserver` only inside `layout.service.ts`; no RxJS creep; signal purity (no side effects in computeds — note `openResponsive` is imperative-by-design); strict typing (watch the `paneResult` union helper and the FAB's `viewChild()?.` guards); `npm run lint`. Fix + commit as `refactor(...)` if needed.

### 5.3 Loose ends flagged by subagents (triage: fix now or defer to Task 03)
- `EntryList.openBatchOperations()` is a **silent no-op** with an empty sidebar selection — suggested snackbar hint (matches existing app patterns; small fix in `entry-list.ts`).
- Desktop M3 defaults (40px icon buttons, 32px chips) are below the 44px floor by design — documented decision; revisit only if a desktop-wide floor is wanted (belongs in the global block, not per-component).
- P1 nuance: topbar `isDesktop` is `true` on the first synchronous tick (was `false`) — no consumer cares today; noted for reviewers.

### 5.4 Final steps
- `docs(next_tasks)`: mark task 02 completed in `README.md` (+ optionally delete/annotate `02-PROGRESS.md`) — mirrors Task 01's `109061d` completion commit.
- Final report to the user with the browser-walkthrough results and screenshots.

---

## 6. Tooling notes for the next session

- **Angular MCP (`angular-cli`) and Playwright MCP are NOT connected** in this environment — subagents fell back to `angular-developer` skill + `node_modules/@angular/material` typings, per the README convention. Keep doing that unless they appear.
- Subagent dispatches used the registered agent types `ui-specialist` (P1, P2, P3, P4∥P5) and will use `qa-auditor` (P6) and `ts-reviewer` (P7). Continuing an agent mid-thread is possible via `SendMessage` with ids: P1 `agent_d36fc74f-d115-4cbf-b553-d4a8b5d952c9`, P2 `agent_025634ab-2b09-406d-b206-27223fc086d1`, P3 `agent_f3482712-ca4d-4903-b394-376bebaaa68a`, P4 `agent_e52e6c6d-da11-4868-aede-e8ecd48a041e`, P5 `agent_9e1185dd-5b6e-497d-8789-a0d674aa9076` (fresh sessions are equally fine — prompts must be self-contained).
- Parallel dispatch rule that worked: only over disjoint file sets; P4 got `mobile-fab/*, app.*, topbar.ts, responsive-overlay.service.*` and P5 got `touch-targets.ts, styles.scss + per-component SCSS`; targeted vitest runs per agent, full gates serialized by the orchestrator afterwards.
- Skills actually used: `angular-developer`, `material-3` (via subagents), `browser-use:control-browser` (main agent only — Browser Use must NOT be delegated to subagents). `frontend-design` skill is available if a visual-polish pass is wanted.
- Commit format: conventional, one atomic commit per phase (matches Task 01 history).
