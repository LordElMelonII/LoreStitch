# shared/

Cross-feature building blocks: `components/` (confirm dialog, diff viewer), `constants/` (breakpoints, touch-target sizes, GitHub links, search debounce), `directives/` (touch-safe nested menus), `services/` (layout state, responsive overlay), and `util/` (bare helpers that need Angular but no UI — the debounced signal). UI-coupled by nature — this is why they live outside `core/`.
