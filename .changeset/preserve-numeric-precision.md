---
"@oasis/core": patch
"@oasis/bundler": patch
---

fix(bundler): preserve numeric literals beyond JavaScript `Number` precision when bundling (#98).
Large integers (past `Number.MAX_SAFE_INTEGER`, e.g. int64 values) and high-precision or
exponent-form decimals used in `const`/`default`/`example`, bounds, `multipleOf`, and arbitrary
extension data are now emitted byte-for-byte from the original source in both YAML and JSON output
instead of the rounded value. Values that round-trip exactly (and cosmetic forms like `1.0` or
`1e3`) are unchanged, JSON output never throws on internally large values, and source ranges,
aliases, and linter numeric checks are unaffected.
