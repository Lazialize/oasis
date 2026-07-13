---
"@oasis/bundler": patch
---

Fix bundling of Path Item Objects in webhook and callback positions. Root-level 3.1 `webhooks`
entries and the runtime-expression entries of a Callback Object are now recognized as Path Item
slots: a path-item `$ref` there is inlined in place (with 3.1 `summary`/`description` siblings
preserved) instead of being invalidly lifted into `components`. A `$ref` at `callbacks/<name>`
(a whole Callback Object) still lifts into `components/callbacks`, and refs inside an inlined path
item are still lifted normally.
