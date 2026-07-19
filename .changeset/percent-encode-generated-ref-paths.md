---
"@oasis/server": patch
---

fix(server): percent-encode generated file paths in `$ref` completions and code-action edits.
`relativeRefPath` (used by cross-file `$ref` completion, extract-to-component, and inline/relocate)
returned the raw, unencoded result of `node:path.relative`, so a target filename containing `#`
produced a reference like `./foo#bar.yaml#/components/schemas/Foo` — indistinguishable from a
`./foo` file part with a `bar.yaml#/components/schemas/Foo` fragment, so the generated reference
was unresolved. Other reserved/special characters (`%`, spaces, quotes, non-ASCII) could likewise
produce invalid URI or YAML/JSON text. Each relative path segment is now percent-encoded as a URI
reference (leaving only RFC 3986 unreserved characters literal), so a generated reference always
resolves back to the intended file and can never smuggle a raw quote into the surrounding YAML
single-quoted or JSON double-quoted scalar.
