# shared/services/

- `layout.service.ts` — viewport signals (handset/tablet) + focus mode.
- `responsive-overlay.service.ts` — `openResponsive`: the only sanctioned way to open dual-container panes (MatDialog on tablet/desktop, MatBottomSheet on phones).

**Hints**

- Never branch on viewport at a call site — route through `openResponsive` and let the pane adapt via optional `MatDialogRef`/`MatBottomSheetRef` injections.
