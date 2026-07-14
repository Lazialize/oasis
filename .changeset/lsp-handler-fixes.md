---
"@oasis/server": patch
---

LSP server handler fixes and improvements:

- Rename validates new component names against the component-key grammar (`^[A-Za-z0-9._-]+$`) and
  returns a rename error instead of writing a partial, YAML-corrupting edit; replacement text is
  encoded for its syntactic context (JSON keys double-quoted, YAML keys quoted when they would be
  reinterpreted).
- Find References and Rename now count `$ref`s that resolve to nested pointers under a component
  (e.g. `#/components/schemas/Foo/properties/id`); rename replaces only the component-name segment
  and preserves the suffix.
- Rename, Find References, and prepareRename share one semantic reference index that includes
  name-based OpenAPI references: Security Requirement Object keys (root and operation scope) and
  discriminator `mapping` values (bare-name form preserved, URI form edited as a pointer segment).
- Inline/extract code actions rebase internal references when they move a subtree across documents
  (same-document and file-relative refs are re-relativized; absolute URIs left unchanged), and are
  suppressed when relocation cannot be made safe (YAML anchors/aliases, `$id`/`$anchor` scopes,
  plain-name anchor fragments, `file:` URIs).
- The add-missing-path-parameter quick fix replaces an inline empty `parameters: []` with a valid
  block sequence instead of producing malformed YAML.
- Document symbols include OpenAPI 3.1 root-level `webhooks` (with operation children); 3.0
  documents are unchanged.
- Document links classify `$ref` values per RFC 3986: absolute non-filesystem URIs without a `//`
  authority (e.g. `urn:example:schema`) are no longer exposed as clickable local file links.
