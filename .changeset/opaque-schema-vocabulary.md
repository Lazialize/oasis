---
"@oasis/bundler": patch
---

fix(bundler): preserve unknown OpenAPI 3.1 Schema Object keyword payloads as opaque data instead of
interpreting OpenAPI-shaped property names inside them as structural fields.
