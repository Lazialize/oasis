# Built-in rules

Every rule Oasis ships with, grouped by namespace. `Rule` links to a reference page with a full
description, version notes (where 3.0, 3.1, and 3.2 behavior differs), options (if any), and examples.
`Default` is the severity applied when a rule isn't mentioned in `lint.rules` — see the
[Configuration](../../README.md#configuration) section of the README for how to override it.

`oasis/config` is a reserved pseudo-rule id used for diagnostics about the configuration or
invocation itself (an unknown rule name, a missing `entries` path, …). It isn't a real rule: it
can't be configured or suppressed, and has no page here.

## `structure/*` — document shape and OpenAPI Schema Object validation

| Rule | Default | Summary |
| --- | --- | --- |
| [`structure/required-fields`](structure/required-fields.md) | error | `openapi`, `info.title`, `info.version`, `paths` (or 3.1/3.2 `webhooks`/`components`) are present |
| [`structure/openapi-version`](structure/openapi-version.md) | error | `openapi` is a valid `3.0.x` / `3.1.x` / `3.2.x` string |
| [`structure/field-types`](structure/field-types.md) | error | Common objects (paths, operations, parameters, responses, components…) have the right shapes |
| [`structure/http-methods`](structure/http-methods.md) | error | Only valid HTTP verbs / metadata keys appear under a path item |
| [`structure/schema-nullable`](structure/schema-nullable.md) | error | 3.0: no `type` arrays / `null` type; 3.1/3.2: no `nullable` — in every schema, including inline ones |
| [`structure/schema-keywords`](structure/schema-keywords.md) | error | Schema Object keywords match the document's dialect, value types, internal consistency, and `$ref` sibling-key rules |
| [`structure/security-schemes`](structure/security-schemes.md) | error | `components/securitySchemes` entries have a recognized `type` and that type's required fields |
| [`structure/server-variables`](structure/server-variables.md) | error | Server Object `variables` agree with `{var}` placeholders in `url`; `enum`/`default` shape |
| [`structure/encoding`](structure/encoding.md) | error | Media Type Object `encoding` keys match schema properties; `encoding` field shapes |
| [`structure/xml`](structure/xml.md) | error | Schema Object `xml` field: allowed keys, types, and `namespace` looks like an absolute URI |
| [`structure/examples`](structure/examples.md) | error | Example Objects: `value`/`externalValue` are mutually exclusive, only known keys are used |
| [`structure/discriminator`](structure/discriminator.md) | error | Discriminator Objects: required fields, `mapping` targets resolve, composition requirements |
| [`structure/callbacks`](structure/callbacks.md) | error | Callback Objects: expression keys look like runtime expressions/URLs, mapped operations declare `responses` |
| [`structure/links`](structure/links.md) | error | Link Objects: exactly one of `operationRef`/`operationId`, both resolve in-workspace |

## `syntax/*` — source-level YAML/JSON

| Rule | Default | Summary |
| --- | --- | --- |
| [`syntax/no-duplicate-keys`](syntax/no-duplicate-keys.md) | error | Duplicate mapping keys in YAML/JSON |

## `refs/*` — `$ref` resolution

| Rule | Default | Summary |
| --- | --- | --- |
| [`refs/no-unresolved`](refs/no-unresolved.md) | error | Every `$ref` resolves (missing files *and* missing pointers) |
| [`refs/no-cycle`](refs/no-cycle.md) | warn | Cross-file reference cycles |

## `operation/*` — Operation Object quality

| Rule | Default | Summary |
| --- | --- | --- |
| [`operation/operation-id`](operation/operation-id.md) | error | `operationId` present and unique across the workspace (including 3.1 `webhooks`) |
| [`operation/tags`](operation/tags.md) | warn | Operations have at least one non-empty tag |
| [`operation/description`](operation/description.md) | warn | Operations have a `description` or `summary` |
| [`operation/success-response`](operation/success-response.md) | warn | Operations declare at least one 2xx/3xx response (`default` alone doesn't count) |

## `paths/*` — Path Item / routing

| Rule | Default | Summary |
| --- | --- | --- |
| [`paths/params-defined`](paths/params-defined.md) | error | `{param}` templates and `in: path` parameters agree; path params are `required` |
| [`paths/no-duplicates`](paths/no-duplicates.md) | error | Path templates equivalent up to parameter names (`/users/{id}` vs `/users/{userId}`) |

## `components/*` — component hygiene

| Rule | Default | Summary |
| --- | --- | --- |
| [`components/no-unused`](components/no-unused.md) | warn | Components nothing references, by `$ref` or by name |

## `security/*`

| Rule | Default | Summary |
| --- | --- | --- |
| [`security/defined`](security/defined.md) | error | `security` requirement scheme names exist in `components/securitySchemes` |

## `tags/*`

| Rule | Default | Summary |
| --- | --- | --- |
| [`tags/defined`](tags/defined.md) | off | Operation tags are declared in the root `tags` list |
| [`tags/no-unused`](tags/no-unused.md) | warn | Root `tags` list entries are used by at least one operation |

## `style/*`

| Rule | Default | Summary |
| --- | --- | --- |
| [`style/naming-convention`](style/naming-convention.md) | off | Configurable casing for operationIds, component names, parameter names, schema property names |

## `examples/*`

| Rule | Default | Summary |
| --- | --- | --- |
| [`examples/schema-match`](examples/schema-match.md) | warn | `example`/`examples[].value` values conform to their schema, version-aware |

---

Notes that apply across most of the table above (see the [README](../../README.md#built-in-rules)
for the full statement):

- Operation-level rules (`operation/*`, `security/defined`, `tags/defined`,
  `style/naming-convention`'s `operationId`/`parameterName` targets, `examples/schema-match`) also
  cover operations under the root `webhooks` map on 3.1 documents.
- Path-shaped rules (`paths/params-defined`, `paths/no-duplicates`) apply to `paths` only —
  webhook keys are arbitrary names, not URL templates.
- Schema rules (`structure/schema-nullable`, `structure/schema-keywords`,
  `style/naming-convention`'s `propertyName` target, `examples/schema-match`) check every schema
  site: `components` entries plus inline request/response media types, parameters, and headers.
- Syntax errors (`syntax/no-duplicate-keys`) are always reported as errors and cannot be disabled.
