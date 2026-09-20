# shell/mobile-bottom-bar/

Phone-only bottom action bar (New entry, Search, Export, Batch edit, History) — the mobile answer to desktop toolbars; hidden on tablet/desktop breakpoints. Always docked while a phone session has a project: an open drawer lowers it to `backgrounded` via its `barState` input (scrim veil + inert content — the strip sits below the sidenav container, so it synthesizes the scrim look instead of inheriting it), and full-viewport CDK overlays simply cover it.
