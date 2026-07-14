---
"@oasis/linter": patch
---

Two `security/defined` fixes:

- Resolve security scheme names in the correct document scope (#37): requirement keys are implicit
  component-name references and now resolve only against the entry document's
  `components/securitySchemes` — a same-named scheme in an unrelated referenced file no longer
  makes an undefined requirement appear valid. Diagnostics stay source-ranged to the requirement.
  `components/no-unused` applies the same scope rule to its by-name security scheme exemption.
- Allow role names for non-OAuth security schemes in OpenAPI 3.1 (#38): on 3.0, non-OAuth
  (`apiKey`/`http`/`mutualTLS`) requirement arrays must still be empty; on 3.1 the Security
  Requirement Object explicitly permits role names there, so non-empty arrays are accepted.
  OAuth2 values remain validated as declared scopes on both versions.
