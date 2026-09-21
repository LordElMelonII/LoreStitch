# entry-editor/entry-keys/

Primary and secondary key chips with SillyTavern's four selective-logic modes (AND Any / NOT All / NOT Any / AND All).

## Test keys panel (`regex-test-panel`)

Collapsible, presentation-only sandbox: a component-local sample text drives per-key match rows and a read-only highlighted preview through `findStKeyMatches` (Task 04). Above the rows, a verdict banner states the joint entry-level outcome via `core/models/st-trigger`'s `evaluateStTrigger` (Task 08) — inserted, probabilistic, blocked (disabled / no keys / no primary match / secondary-logic denial), or inconclusive when only Vector Storage similarity could still insert. Matched secondary keys under NOT Any / NOT All carry a `(blocks activation)` suffix while they deny the entry; the hint lists what can still override the live outcome (probability rolls, sticky/cooldown timers, inclusion-group budget, recursion, Vector Storage).
