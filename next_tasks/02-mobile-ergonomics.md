# Task 02 — Mobile Ergonomics & Responsive Viewport Guardrails

> **Source**: `ROADMAP.md` → MEDIUM PRIORITY → *"Mobile Ergonomics & Responsive Viewport Guardrails"*
> **Type**: Refactor + feature (responsive overlays, mobile FAB navigation, touch-target audit, E2E guardrails)
> **Suggested agents**: `ui-specialist` (lead) → `qa-auditor` → `ts-reviewer`
> **⚠ Must land before Task 03** — the Linter modal is required by the ROADMAP to open as a bottom sheet on narrow screens, and this task produces the reusable pattern it will consume.

---

## 1. Objective

Guarantee that LoreStitch's desktop-heavy surfaces (modals, drawers, batch tooling) remain fully usable at phone widths as an installable PWA: every action dialog becomes a bottom sheet below 768px, core actions get a mobile FAB so they don't depend on keyboard shortcuts, all interactive elements meet the touch-target floor, and automated mobile-viewport tests prevent regressions.

## 2. Current State (code audit, `develop` @ `4120bb9`)

- **`src/app/shared/services/layout.service.ts` exists but is minimal** — only a `focusMode` signal + toggle. No viewport state.
- **`src/app/shared/constants/breakpoints.ts` exists**: `MOBILE_BREAKPOINT_QUERY = '(max-width: 767px)'`, `TABLET_… = 768–1279px`, `DESKTOP_… = ≥1280px`, `type ViewportClass = 'mobile' | 'tablet' | 'desktop'`.
- **Four independent `BreakpointObserver` consumers** duplicate viewport logic: `app.ts` (`viewport` signal driving sidenav modes + host classes), `topbar.ts` (`isDesktop`, `isMobile`), `project-actions.service.ts` (merge dialog `mode: 'unified' | 'split'`), `entry-options-accordion.ts` (`isMobile` host class).
- **Reference bottom-sheet pattern already implemented once** (About dialog, commit `4120bb9`):
  - Component injects **both refs optionally**: `inject(MatDialogRef, { optional: true })` + `inject(MatBottomSheetRef, { optional: true })`; paints its own header (no `mat-dialog-content`) so it renders in either container.
  - Caller branches: `isMobile() ? bottomSheet.open(AboutDialog, { panelClass: 'app-about-sheet' }) : dialog.open(AboutDialog, { … , panelClass: 'app-about-dialog' })`.
  - Container sizing lives in global `styles.scss` (`.app-about-sheet .mat-bottom-sheet-container { height: 88dvh; … }`).
- **Dialog inventory & responsive status**: all dialogs use `panelClass: 'app-compact-fullscreen-dialog'` (full-screen ≤599px) + desktop `maxWidth`. Only **AboutDialog** is a bottom sheet. ROADMAP-listed for conversion: **BatchOperationsDialog** (`features/entry-list/batch-operations-dialog.ts`), **MergeResolverDialog** (`features/merge-resolver/merge-resolver-dialog.ts`); adjacent candidates: `export-selected-dialog.ts`, `search-replace-dialog.ts`, `token-inspector-dialog.ts`. (Linter modal doesn't exist yet — Task 03.)
- **Two deliberately distinct breakpoint systems** (documented in `topbar.scss`): shell breakpoint **<768px** (sidenav/sheet decisions) vs MD3 compact dialog window **≤599px**. Keep both, but codify the rule.
- **No FAB anywhere** (`MatFabButton` unused). Mobile navigation today: hamburger (entries drawer, `over` mode), history button, More-vert menu; batch bar is an inline `div[role=toolbar]` in the entry-list header.
- **Touch targets**: global rule in `styles.scss` (≤767px): icon buttons 48px, `.mat-mdc-button-base` min-height 48px, toggles 48px, chips 48px. Per-component floors are **mixed 44/48px** (`about-dialog.scss` 44, `entry-list.scss` `.tag-chip` 44, `export-selected-dialog.scss` 44 rows, `batch-operations-dialog.scss` 48, `token-inspector-dialog.scss` 44). E2E already asserts 48px for visible topbar icon buttons on mobile.
- **Playwright**: three projects configured — `desktop-chrome`, `mobile-chrome` (Pixel 7), `mobile-safari` (iPhone 14). `e2e/ui-responsiveness.spec.ts` (512 lines) loops 5 viewports (1920, 1280, 768, 390, 412) checking horizontal overflow, drawer modes, focus mode, touch targets, delimiter-dialog full-screen behavior, and a whole-DOM overflow poll.

### Gaps

1. Viewport state is fragmented across 4 consumers (drift risk — already two `isMobile` derivations).
2. The bottom-sheet pattern is copy-paste per dialog; nothing reusable.
3. Batch/Merge dialogs are unusable-ish tall-content dialogs on phones (fullscreen-at-599 only, no sheet ergonomics).
4. No mobile affordance for New Entry / Search / Export (keyboard + desktop-only icon buttons).
5. Touch-target floors inconsistent (44 vs 48) and only topbar buttons are E2E-guarded.
6. Mobile Playwright projects exist but per-spec mobile gating/coverage is unverified.

## 3. Design

### 3.1 Single source of viewport truth — extend `LayoutService`

```ts
@Service()
export class LayoutService {
  readonly focusMode = signal(false);                       // existing
  readonly viewport = signal<ViewportClass>('desktop');     // new: toSignal(BreakpointObserver.observe([...]), …)
  readonly isMobile = computed(() => this.viewport() === 'mobile');
  readonly isDesktop = computed(() => this.viewport() === 'desktop');
}
```

Migrate the four consumers (`app.ts`, `topbar.ts`, `project-actions.service.ts`, `entry-options-accordion.ts`) to inject `LayoutService` instead of private `BreakpointObserver` subscriptions. `breakpoints.ts` gains a doc comment codifying the two-system rule: **768px = shell/sheet breakpoint, 599px = MD3 compact-dialog window**.

### 3.2 Reusable responsive-overlay opener (extract the About pattern)

New `src/app/shared/services/responsive-overlay.service.ts`:

```ts
@Service()
openResponsive<T, D, R>(component: ComponentType<T>, config: {
  data?: D;
  dialog: MatDialogConfig;        // width/panelClass for ≥768px
  sheetPanelClass?: string;       // bottom-sheet panelClass for <768px (optional → dialog-only)
}): MatDialogRef<T, R> | MatBottomSheetRef<T, R>;
```

- Branches on `layout.isMobile()`; when `sheetPanelClass` is absent, falls back to the dialog path (not every dialog needs a sheet).
- Sheet sizing classes (`.app-*-sheet .mat-bottom-sheet-container { height: NNdvh; padding: 0 }`) stay in global `styles.scss` per the charter (panelClass-configured overlay styles).
- Converted dialogs adopt the **dual-optional-ref** component shape from `about-dialog.ts` (both `MatDialogRef` and `MatBottomSheetRef` optional; self-painted header; `close()` handles both).
- Migrate `topbar.openAbout()` to the helper first (proves the extraction with zero behavior change), then convert **BatchOperationsDialog**, **MergeResolverDialog**, and **ExportSelectedDialog**. Merge resolver keeps its mobile `unified` diff mode; sheet height `~92dvh` with pinned actions.
- Task 03's Linter modal will call `openResponsive(...)` from day one instead of duplicating the branch.

### 3.3 Mobile FAB navigation (collapsible)

> **⚠ AMENDMENT (2026-09-18, implementation):** the FAB was **replaced by a bottom action bar** (`features/shell/mobile-bottom-bar/`) after real-device testing showed the fixed FAB covering the entry editor's bottom-right accordion toggle, and the user elected Google's M3 bottom-bar pattern over a FAB. The bar mounts as a normal flex child of app-root (topbar / workspace / bar — never fixed-positioned), hosts five labeled actions (New entry, Search, Export menu, Batch edit, History — the last moved off the mobile topbar to free topbar space), hides while overlays or drawers are open, and pads `env(safe-area-inset-bottom)`. The overlay-count addition to `ResponsiveOverlayService` (`anyOverlayOpen`) landed as designed. Details in `02-PROGRESS.md` and the `feat(shell)` commits. The original FAB design below is kept for the record.

- Visible only when `layout.viewport() === 'mobile'` and a project is open; anchored bottom-end with `env(safe-area-inset-bottom)` offset (PWA install/iOS gesture bar).
- Collapsed: single M3 FAB (`menu` icon, `aria-expanded`, `aria-controls`). Expanded: vertical stack of small-FAB/button actions with labels — **New Entry**, **Search & Replace**, **Export**, **Batch Operations** — mirroring the desktop topbar's desktop-only icon set so no core action requires a keyboard or a hidden menu.
- Behavior details: Escape collapses; selecting an entry list row or opening a drawer collapses; z-index above sidenav-over overlay; must not cover the entry-list batch bar (bottom sheet region) — position above safe area with 16px inset, and hide while any overlay/sheet is open.
- Styling: M3 tokens only (`--mat-sys-*`, FAB container/color/elevation tokens) in a new `src/app/features/shell/mobile-fab/` component (`mobile-fab.ts/.html/.scss/.spec.ts`), mounted by `app.html` inside `.workspace` (outside the scrollable editor pane).

### 3.4 Touch-target audit & standardization

- Decision (reconcile ROADMAP's "44×44" with the global 48px mobile rule): **44px is the universal floor, 48px is the mobile target** — matches the `ui-specialist` persona (44 min) and current global SCSS (48 on mobile).
- Add `TOUCH_TARGET_MIN = 44` and `TOUCH_TARGET_MOBILE = 48` constants to `src/app/shared/constants/breakpoints.ts` (or a sibling `touch-targets.ts`) and reference them from SCSS via documented values (CSS custom properties `--touch-target-min`).
- Audit checklist (interactive elements only, no visual redesign): entry-list rows + row action ghosts, `.tag-chip` plain buttons, accordion headers (`entry-options-accordion`), batch bar buttons, dialog action rows (44→48 on the 44px holdouts: `about-dialog`, `export-selected-dialog`, `token-inspector-dialog`), checkbox/radio rows in batch + export dialogs.

### 3.5 Mobile E2E expansion (`e2e/ui-responsiveness.spec.ts` + per-dialog specs)

1. **Bottom-sheet assertions** (mobile viewports 390/412 + mobile projects): Batch/Merge/Export/About open as `.mat-bottom-sheet-container`, actions visible within viewport, no horizontal overflow, Escape dismisses.
2. **FAB flows**: FAB visible on mobile / absent ≥768px; expand → all four actions reachable ≥44px; "New Entry" creates an entry and focuses the name field; collapses on Escape/overlay-open.
3. **Generalized touch-target guard**: extend the existing topbar-only 48px check to entry rows, accordion headers, batch bar buttons, and FAB actions on mobile viewports.
4. **Overflow regression poll**: keep the whole-DOM check; add sheet content scrollability (`scrollHeight > clientHeight` ⇒ scrollable, actions pinned).
5. **Project gating**: audit which specs run on `mobile-chrome`/`mobile-safari`; add `test.skip(({ viewport }) => viewport.width >= 768)` gates mirroring `about-dialog.spec.ts` so mobile projects execute the mobile-relevant suites (keeps runtime bounded).

## 4. Implementation Plan

| Phase | Files | Work |
|-------|-------|------|
| **P1 — Viewport consolidation** (ui-specialist) | `shared/services/layout.service.ts` (+spec), `shared/constants/breakpoints.ts`, `app.ts`, `topbar.ts`, `project-actions.service.ts`, `entry-options-accordion.ts` | §3.1; behavior-neutral refactor, each consumer migrated with its spec updated |
| **P2 — Overlay helper + About migration** (ui-specialist) | `shared/services/responsive-overlay.service.ts` (+spec), `topbar.ts`, `styles.scss` | §3.2 extraction; About route through helper; zero visual change |
| **P3 — Dialog conversions** (ui-specialist) | `entry-list/batch-operations-dialog.*`, `merge-resolver/merge-resolver-dialog.*`, `merge-resolver/export-selected-dialog.*`, `styles.scss` | §3.2 dual-ref shape + sheet classes; specs gain sheet-mode cases |
| **P4 — Mobile FAB** (ui-specialist) | `features/shell/mobile-fab/*` (new), `app.html`, `app.scss` | §3.3 component + integration + unit spec |
| **P5 — Touch targets** (ui-specialist) | constants + the SCSS holdouts listed in §3.4 | §3.4 audit fixes |
| **P6 — E2E** (qa-auditor) | `e2e/ui-responsiveness.spec.ts`, `e2e/batch-and-tokens.spec.ts`, `e2e/about-dialog.spec.ts`, per-dialog specs | §3.5; verify mobile-project gating |
| **P7 — Review** (ts-reviewer) | all touched | Signal purity (no side effects in computeds), typing, lint |

P1–P2 sequential; P3, P4, P5 are parallelizable after P2; P6 after P3–P5.

## 5. Orchestration

1. **`ui-specialist`** (skills: `angular-developer`, `material-3`; verify dialog/bottom-sheet APIs against installed `node_modules/@angular/material` typings — use the `angular-cli` MCP only if the orchestrator confirms it is connected) — P1→P5. Standalone OnPush components, signal queries, M3 tokens, no `::ng-deep`; every new/changed component ships its spec.
2. **`qa-auditor`** (skills: `playwright-cli`, `angular-developer`) — P6. Runs mobile projects explicitly, enforces coverage thresholds, updates the pre-handoff checklist (`npm run build`, `npm test`, `ng test --coverage`, `npx playwright test`).
3. **`ts-reviewer`** (skills: `typescript-advanced-types`) — P7 review gate: no RxJS creep (BreakpointObserver stays only inside `LayoutService`), strict types, `npm run lint`.

Dispatch note for the orchestrator: P1–P2 and P4–P5 can be **parallel subagent runs** (P4/P5 don't depend on the overlay helper; file sets are disjoint — P4: `mobile-fab/*` + `app.*`, P5: constants + per-component SCSS); keep P3 with the same agent as P2 to preserve pattern fidelity. The orchestrator serializes commits from parallel runs and runs gates between dispatches. Before P1, re-read `topbar.ts/.html/.scss/.spec.ts` at current HEAD — Task 01 touched the topbar after this audit was taken.

## 6. Verification Gates

`npm run build` · `npm test` · `ng test --coverage` (layout.service + mobile-fab + converted dialogs covered) · `npx playwright test` (all three projects; mobile projects must run the new mobile specs) · `npm run lint`.

## 7. Risks & Open Questions

1. **Merge resolver in a sheet**: side-by-side diffs are unusable at phone width even in a sheet — mobile already forces `unified` mode; confirm 92dvh + pinned actions is enough for 3-way merge actions, else gate the *split* trigger behind desktop only (already the case via `project-actions.service`).
2. **FAB vs. bottom overlays**: overlap with sidenav-over backdrop, sheets, and the iOS safe area. Mitigation: hide FAB while any overlay is open; safe-area insets; covered by P6 tests.
3. **Mobile-project runtime**: enabling more specs on two extra projects increases CI time — bound it via §3.5.5 gating.
4. **Behavior-neutral refactor risk (P1/P2)**: any drift in drawer default-open states is caught by the existing `ui-responsiveness` drawer-mode assertions — run them per phase, not only at P6.
