---
"@oasis/core": minor
---

Add URI-aware reference handling for OpenAPI 3.1 Schema Objects (JSON Schema 2020-12). Core now
classifies `$ref` values with an RFC 3986-aware classifier (`classifyUriReference`, `uriScheme`,
`isExternalUriReference`): absolute non-filesystem URIs (`https:`, `urn:`, ...) are reported as
unsupported external references instead of being turned into bogus file lookups. For 3.1 documents,
core builds a per-document anchor index (`buildAnchorIndex`, `resolveAnchor`) of `$id` scopes,
`$anchor`, and `$dynamicAnchor`, and `resolveRef` resolves plain-name `#anchor` fragments
(including percent-encoded ones) to their schema, preserving source ranges. OpenAPI Reference
Objects and 3.0 documents keep their existing JSON-Pointer behavior.
