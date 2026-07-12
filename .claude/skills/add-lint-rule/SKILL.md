---
name: add-lint-rule
description: Add a new built-in lint rule to the Oasis linter — rule file, registration, tests, and README docs
---

# Adding a built-in lint rule

1. Create `packages/linter/src/rules/<namespace>-<leaf>.ts` exporting a `Rule` (interface in `packages/linter/src/types.ts`). Follow an existing rule as the pattern — `operation-tags.ts` is a small one. Reuse the walk helpers (`iterateOperations` in `openapi-walk.ts`, `childAt` in `util.ts`) where they fit.
2. Register it in `packages/linter/src/rules/index.ts`, in **both** places: the `rules` array (its order is stable and user-facing) and the named re-exports.
3. The rule `name` is the user's config key in `oasis.config.jsonc` (`lint.rules`), namespaced as `<namespace>/<leaf-name>` (e.g. `operation/tags`). The file name follows the same namespace, kebab-cased with a hyphen in place of the slash (e.g. `operation-tags.ts`).
4. If the check depends on OpenAPI version, branch on the document version (3.0 `nullable` vs 3.1 `type` arrays / `null`) and cover both in tests.
5. Add tests in `packages/linter/tests/` with fixture documents covering good and bad cases. Run `bun test packages/linter`.
6. Add a row to the "Built-in rules" table in README.md: rule name, default severity, one-line description of the check.
