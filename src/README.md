# src/

Application source root: `index.html` (static shell), `main.ts` (bootstrap), `styles.scss` (global Material 3 tokens and overlay `panelClass` styles).

**Hints**

- Dialogs, menus, and bottom sheets render outside component scope — their custom panel styles go in `styles.scss`, never `::ng-deep`.
