---
"@oasis/bundler": patch
---

fix(bundler): preserve `__proto__` keys in bundled output instead of silently dropping them.
Component names, schema property names, literal payload keys, and extension payload keys are now
assigned as own data properties, so a key literally named `__proto__` (a valid OpenAPI component
name and a valid arbitrary schema property name) no longer triggers the legacy
`Object.prototype.__proto__` setter and disappears from the bundle (#99).
