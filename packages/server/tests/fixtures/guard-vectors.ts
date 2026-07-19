// Shared positive/negative test vectors for the "looks like OpenAPI" root-key guard (issue #122).
// Run against both packages/server/src/openapi-guard.ts and editors/vscode/src/openapi-guard.ts
// so the two duplicated implementations (see notes at the top of each file) stay behaviorally
// identical. Do not import across the Bun-workspace / npm-extension boundary at build time —
// only test files reach across via a relative path.

export type GuardVector = {
  readonly name: string;
  readonly input: string;
  readonly expected: boolean;
};

export const guardVectors: readonly GuardVector[] = [
  // --- YAML comments must not be scanned as mapping content (issue #122 repro) ---
  {
    name: "YAML comment containing 'openapi:' inside a flow root does NOT match",
    input: "{ # openapi: fake\n  foo: bar }",
    expected: false,
  },
  {
    name: "YAML comment on its own line before a real root key does not block the real key",
    input: "# openapi: fake\nopenapi: 3.1.0\n",
    expected: true,
  },

  // --- JSONC comments must not be scanned as mapping content (issue #122 repro) ---
  {
    name: "JSONC line comment containing an openapi key inside a flow root does NOT match",
    input: '{ // "openapi": "fake"\n  "foo": 1 }',
    expected: false,
  },
  {
    name: "JSONC block comment containing an openapi key inside a flow root does NOT match",
    input: '{ /* "openapi": "fake" */ "foo": 1 }',
    expected: false,
  },
  {
    name: "JSONC line comment lines before the root brace then a flow root matches",
    input: '// generated file\n// do not edit\n{ "openapi": "3.1.0" }',
    expected: true,
  },
  {
    name: "JSONC line comment does not hide a real trailing root key",
    input: '{ // leading comment\n  "openapi": "3.1.0" }',
    expected: true,
  },

  // --- Escaped/quoted keys should decode sufficiently to compare against "openapi" ---
  {
    name: "unicode-escaped root key decodes to openapi and matches",
    input: '{"\\u006f\\u0070\\u0065\\u006e\\u0061\\u0070\\u0069": "3.1.0"}',
    expected: true,
  },
  {
    name: "mixed literal/escape root key decodes to openapi and matches",
    input: '{"open\\u0061pi": "3.1.0"}',
    expected: true,
  },
  {
    name: "escaped quote inside an unrelated string value does not confuse the scanner",
    input: '{"note": "a \\"quoted\\" value", "openapi": "3.1.0"}',
    expected: true,
  },
  {
    name: "escaped backslash immediately before closing quote does not swallow the terminator",
    input: '{"path": "C:\\\\", "openapi": "3.1.0"}',
    expected: true,
  },

  // --- Document directives / markers / leading comments before the root mapping ---
  {
    name: "document marker followed by a flow root on the next line matches",
    input: "---\n{openapi: 3.1.0}\n",
    expected: true,
  },
  {
    name: "document marker followed by a block root key on the next line matches",
    input: "---\nopenapi: 3.1.0\n",
    expected: true,
  },
  {
    name: "YAML directive, marker, then flow root matches",
    input: "%YAML 1.2\n---\n{openapi: 3.1.0}\n",
    expected: true,
  },
  {
    name: "leading comment lines then a flow root matches",
    input: "# generated file\n# do not edit\n{openapi: 3.1.0}\n",
    expected: true,
  },
  {
    name: "leading comment lines then a block root key matches",
    input: "# generated file\nopenapi: 3.1.0\n",
    expected: true,
  },
  {
    name: "marker with a trailing comment then a root key on the next line matches",
    input: "--- # start of document\nopenapi: 3.1.0\n",
    expected: true,
  },
  {
    name: "blank lines between marker and root key are tolerated",
    input: "---\n\n\nopenapi: 3.1.0\n",
    expected: true,
  },
  {
    name: "a bare '---' marker with no root content does NOT match",
    input: "---\n",
    expected: false,
  },
  {
    name: "a line starting with '----' (not a marker) is not treated as a document marker",
    input: "----\nopenapi: 3.1.0\n",
    expected: true, // still matches because `openapi:` itself is a root-level block key
  },

  // --- Root-level flow / indentation basics (regression coverage) ---
  {
    name: "root-level JSON openapi key with no surrounding whitespace matches",
    input: '{"openapi":"3.1.0"}',
    expected: true,
  },
  {
    name: "indented leading whitespace before a flow root is tolerated",
    input: '   {"openapi": "3.1.0"}',
    expected: true,
  },
  {
    name: "root-level YAML flow mapping matches",
    input: "{openapi: 3.1.0, info: {title: T}}",
    expected: true,
  },

  // --- Nested keys must still NOT match (regression coverage for issue #52) ---
  {
    name: "nested JSON openapi key inside a flow root does NOT match",
    input: '{"metadata": {"openapi": "x"}}',
    expected: false,
  },
  {
    name: "nested YAML block openapi key does NOT match",
    input: "metadata:\n  openapi: not-a-root-key\n",
    expected: false,
  },
  {
    name: "openapi as a value (not a key) does NOT match",
    input: '{"kind": "openapi"}',
    expected: false,
  },
];
