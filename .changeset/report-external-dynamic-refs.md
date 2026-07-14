---
"@oasis/core": patch
"@oasis/bundler": patch
"@oasis/linter": patch
---

Discover OpenAPI 3.1 Schema `$dynamicRef` dependencies and report dynamic references that cannot yet be made self-contained during bundling. Entry-owned fragment-only dynamic references keep their static fallback and dynamic behavior; relocating dynamic scope from external resources remains explicitly unsupported.
