# Roadmap to 1.0

Where Oasis is going between v0.2 (current) and v1.0. DESIGN.md's original milestones
(core → lint → bundle → LSP → VS Code extension) are all shipped; this roadmap is about
turning that foundation into a tool that can be trusted as a daily driver and a credible
alternative to Spectral/Redocly-style toolchains.

**Definition of 1.0:** the config format, CLI interface, rule names, and diagnostic output
are frozen and covered by semver. Lint coverage of the OpenAPI 3.0/3.1 specs is broad enough
that a clean `oasis lint` means the document is structurally sound.

The center of gravity is **lint quality and validation coverage** (v0.3–v0.4); editor
features are polished but not expanded aggressively before 1.0.

## v0.3 — Lint expressiveness

Configuration and rule features needed for real-world adoption.

- **Rule options**: `"rule-name": ["error", { ...options }]` in `oasis.config.jsonc`,
  alongside the existing plain-severity form. Rules declare and validate their own options.
- **Per-glob overrides**: `lint.overrides: [{ files: ["glob"], rules: { ... } }]`,
  matched relative to the config file's directory.
- **Inline suppression** (YAML comments): `# oasis-disable-next-line <rule...>`,
  `# oasis-disable-file <rule...>`. JSON documents: not supported initially (documented).
- **New rules**:
  - `naming-convention` — configurable casing for operationIds, component names,
    parameter names (the flagship consumer of rule options)
  - `operation-success-response` — every operation has at least one 2xx/3xx response
  - `no-duplicate-paths` — template-equivalent paths (`/users/{id}` vs `/users/{userId}`)
  - `security-defined` — `security` requirements ↔ `components/securitySchemes` agree
  - `tags-defined` / `no-unused-tags` — operation tags ↔ root `tags` list
  - `example-schema-match` — `example`/`examples` values validate against their schema
    (version-aware: 3.0 dialect vs 3.1 / JSON Schema 2020-12)

## v0.4 — Structural validation coverage

Make "oasis lint passes" mean something strong.

- Extend `structure/*` rules to the objects not yet validated: security schemes,
  discriminator, callbacks, links, encoding, server variables, XML object, examples object.
- Systematic JSON Schema keyword validation, branching on document version
  (3.0's dialect vs 3.1's Draft 2020-12: `type` arrays, `const`, `prefixItems`, …).
- Large fixture corpus of good/bad documents per spec section; smoke tests against
  well-known real-world specs (petstore, GitHub's API, …).

## v0.5 — CLI & CI experience

- `oasis init` — scaffold an `oasis.config.jsonc`.
- `--format sarif` for `oasis lint`, plus a documented GitHub Code Scanning /
  GitHub Actions recipe.
- Glob support in config `entries` (`"entries": ["apis/**/openapi.yaml"]`).
- Performance pass: benchmark lint/bundle on multi-MB specs, fix hot spots.

## v0.6 — Bundler completeness

- `--dereference` mode: fully inline all refs into a self-contained document
  (cycles are an error, or truncated with a diagnostic).
- Guarantee deterministic output (key order, generated component names) with tests.
- Decide whether 3.1 output may optionally lift path items into `components/pathItems`
  (inline-in-place stays the default either way).

## v0.7 — LSP & VS Code polish

Deliberately scoped small; the editor already covers the core workflows.

- Document links: `$ref` file paths clickable.
- Workspace symbols: search components across the whole workspace.
- Code actions: remove unused component, inline a `$ref`.
- Honor v0.3 features (suppression comments, overrides) in the server; robust re-lint
  on config edits.

## v0.9 — Distribution & stabilization (1.0 RC)

- **VS Code Marketplace**: publish the extension (publisher account, CI publish step
  on release).
- **Homebrew tap**: `Lazialize/homebrew-oasis` formula fed from GitHub Release binaries,
  updated automatically by the release workflow.
- Docs: per-rule reference pages (rule, options, good/bad examples); README restructure.
- Final review of config schema, CLI flags, rule names, JSON output shape —
  **last window for breaking changes**.
- Dogfooding period: bug fixes only.

## v1.0

- Freeze the public surface; semver from here on.
- Migration guide 0.x → 1.0.

## Out of scope for 1.0

- npm publishing of `@oasis/*` packages (distribution is binaries + Marketplace + brew).
- Custom rule plugins (revisit post-1.0).
- Swagger 2.0 support (never planned).
