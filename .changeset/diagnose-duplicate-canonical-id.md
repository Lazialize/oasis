---
"@oasis/core": patch
---

fix(core): diagnose duplicate canonical JSON Schema resource identifiers. When two different
documents (or embedded resources) declared the same canonical `$id`, `loadWorkspaceGraph` let
whichever one was indexed last silently win, so a `$ref` to that URI could resolve to the wrong
schema with no diagnostic. The workspace graph now detects the collision while merging anchor
indexes, emits a source-ranged `no-duplicate-schema-id` diagnostic naming both documents (stable
regardless of load order), and makes the colliding URI unresolvable instead of resolving it to
either claimant. Retrieval aliases and re-indexing the same document as schema-aware after being
first reached generically are unaffected.
