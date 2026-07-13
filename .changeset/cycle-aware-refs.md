---
"@oasis/linter": patch
---

Replace fixed ten-hop reference limits with cycle-aware traversal (#47). `resolveMaybeRef` and the
example validator's schema resolver now follow a `$ref` chain until a concrete target is reached,
resolution fails, or a Reference Object recurs (a cycle) — a valid acyclic chain of any length
(including 11+ links and cross-file chains) now resolves instead of being silently treated as
unresolved. The nested-`allOf` property collector likewise guards against cycles with a visited set
rather than a hop count.
