---
"@oasis/core": patch
"@oasis/linter": patch
---

Classify discriminator mapping values as URI references correctly (#39). A mapping value is a bare
component name (expanded to `#/components/schemas/<name>`) only when it matches
`^[a-zA-Z0-9._-]+$` and contains neither `/` nor `:`; anything else — a relative path
(`./dog.yaml`, `../schemas/dog.yaml`), an absolute scheme without `//` (`urn:`), a fragment, or a
percent-encoded reference — is a URI reference resolved with normal `$ref` semantics.
`looksLikeMappingRef` in core (shared by reference discovery and the bundler) and the
`structure/discriminator` / `components/no-unused` rules now agree on this classification, so
valid relative references are no longer reported unresolved and `urn:`-style values are treated as
external targets instead of bogus component names.
