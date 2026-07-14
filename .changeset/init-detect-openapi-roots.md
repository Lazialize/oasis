---
"@oasis/cli": patch
---

fix(cli): `oasis init` now detects every supported OpenAPI root form — uppercase extensions,
UTF-8 BOMs, YAML flow mappings, document markers, and quoted keys — by reusing the shared
root-aware detection instead of an ad-hoc regex, while still rejecting nested `openapi` keys (#80).
