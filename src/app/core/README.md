# core/

Domain layer, kept free of UI-framework dependencies (no `@angular/material`, no DOM assumptions) so models and services stay unit-testable and portable.

- `models/` — pure data + parsing/serialization logic.
- `services/` — injected services and pure analysis modules.

**Hints**

- Any change that alters exported bytes or entry `content` output is a contract change: user sign-off first (`AGENTS.md`).
