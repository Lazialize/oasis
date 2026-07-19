---
"@oasis/server": patch
---

fix(server): quote YAML-sensitive path parameter names in quick fixes. Parameter names that are reserved YAML keywords (true, false, null), numeric-looking strings, or contain special characters are now properly quoted when inserted as parameter definitions. This ensures that the generated YAML parses correctly and the parameter name round-trips as the intended string value, not as a boolean, null, or number.
