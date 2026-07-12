---
"@oasis/linter": minor
---

Five new `structure/*` rules extend structural validation to object types the linter didn't
previously check: `structure/security-schemes` (Security Scheme Object: valid `type` and
per-type required fields, including 3.1's `mutualTLS`), `structure/server-variables` (Server
Object `variables` agree with `{var}` templates in `url`), `structure/encoding` (Media Type
Object `encoding` keys and field shapes), `structure/xml` (Schema Object `xml` field), and
`structure/examples` (Example Object `value`/`externalValue` exclusivity and allowed keys, in
both `components/examples` and inline `examples` maps). All default to `error` severity except
the unused-server-variable diagnostic, which is a `warn`.
