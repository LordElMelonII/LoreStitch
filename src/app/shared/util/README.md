# shared/util/

Bare helpers that need Angular itself but no UI: `debounced-signal.ts`, the trailing-edge signal mirror both search surfaces debounce behind (Task 07). Exported functions with no `@Service()` decorator — unlike the pure framework-free modules under `core/services/` (`sha256.ts` & co.), these may import from `@angular/core`, which is exactly why they live in `shared/` and not `core/`.
