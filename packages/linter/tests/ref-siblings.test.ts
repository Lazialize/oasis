import { describe, expect, test } from "bun:test";
import { InMemoryFileSystem, loadWorkspaceGraph } from "@oasis/core";
import { lint } from "../src/engine.ts";
import { resolveConfig } from "../src/config.ts";
import type { LintDiagnostic } from "../src/types.ts";

/**
 * Issue #103: when a Schema Object root carries keywords alongside `$ref`, resolving the `$ref`
 * away discarded the referring node and its siblings before schema rules ran. In OpenAPI 3.1
 * (JSON Schema 2020-12) those siblings are meaningful and must be validated; in OpenAPI 3.0 they
 * are ignored per spec but still flagged. Target constraints must keep being checked either way,
 * and every diagnostic must point at the owning file/range of the keyword it's about.
 */

async function lintFiles(files: Record<string, string>, entry = "/virtual/entry.yaml") {
  const fs = new InMemoryFileSystem(files);
  const graph = await loadWorkspaceGraph(fs, entry);
  return lint(graph, resolveConfig(undefined));
}

function byRule(diags: LintDiagnostic[], rule: string) {
  return diags.filter((d) => d.rule === rule);
}

const header31 = `openapi: 3.1.0
info:
  title: RefSiblings
  version: "1.0.0"
`;

const header30 = `openapi: 3.0.3
info:
  title: RefSiblings
  version: "1.0.0"
`;

describe("issue #103: $ref siblings on a component schema root", () => {
  test("3.1 evaluates sibling `nullable` (flagged) and an invalid sibling `type`", async () => {
    const diagnostics = await lintFiles({
      "/virtual/entry.yaml": `${header31}paths: {}
components:
  schemas:
    Base:
      type: string
    Derived:
      $ref: '#/components/schemas/Base'
      nullable: true
      type: wat
`,
    });

    const nullable = byRule(diagnostics, "structure/schema-nullable");
    // The invalid sibling `type: wat` is reported by schema-nullable's type-name check.
    expect(nullable.some((d) => d.message.includes("wat"))).toBe(true);

    const keywords = byRule(diagnostics, "structure/schema-keywords");
    // The 3.1-illegal `nullable` sibling is reported by schema-keywords/schema-nullable.
    expect(
      [...nullable, ...keywords].some((d) => d.message.includes("nullable")),
    ).toBe(true);
  });

  test("3.1 sibling diagnostics point at the Derived node's own file/range, not Base", async () => {
    const src = `${header31}paths: {}
components:
  schemas:
    Base:
      type: string
    Derived:
      $ref: '#/components/schemas/Base'
      type: wat
`;
    const diagnostics = await lintFiles({ "/virtual/entry.yaml": src });
    const watDiag = diagnostics.find((d) => d.message.includes("wat"));
    expect(watDiag).toBeDefined();
    // `type: wat` is on the Derived node — line index within entry.yaml, after Base.
    const lines = src.split("\n");
    const watLine = lines.findIndex((l) => l.includes("type: wat"));
    expect(watDiag?.range.start.line).toBe(watLine);
  });

  test("3.0 flags `$ref` siblings on a component schema root as ignored", async () => {
    const diagnostics = await lintFiles({
      "/virtual/entry.yaml": `${header30}paths: {}
components:
  schemas:
    Base:
      type: string
    Derived:
      $ref: '#/components/schemas/Base'
      nullable: true
`,
    });
    const keywords = byRule(diagnostics, "structure/schema-keywords");
    expect(keywords.some((d) => d.message.includes("Sibling keys"))).toBe(true);
  });

  test("a pure `$ref` component root (no siblings) produces no sibling diagnostics", async () => {
    const diagnostics = await lintFiles({
      "/virtual/entry.yaml": `${header31}paths: {}
components:
  schemas:
    Base:
      type: string
    Alias:
      $ref: '#/components/schemas/Base'
`,
    });
    expect(byRule(diagnostics, "structure/schema-nullable")).toEqual([]);
    expect(byRule(diagnostics, "structure/schema-keywords")).toEqual([]);
  });
});

describe("issue #103: $ref siblings on an inline request/response schema root", () => {
  test("3.1 evaluates an invalid sibling `type` on an inline response schema", async () => {
    const diagnostics = await lintFiles({
      "/virtual/entry.yaml": `${header31}paths:
  /pets:
    get:
      operationId: listPets
      tags: [a]
      description: x
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Base'
                type: wat
components:
  schemas:
    Base:
      type: string
`,
    });
    expect(
      byRule(diagnostics, "structure/schema-nullable").some((d) => d.message.includes("wat")),
    ).toBe(true);
  });
});

describe("issue #103: external ref with siblings", () => {
  test("3.1 evaluates siblings on a cross-file $ref schema root", async () => {
    const diagnostics = await lintFiles({
      "/virtual/entry.yaml": `${header31}paths: {}
components:
  schemas:
    Derived:
      $ref: './shared.yaml#/components/schemas/Base'
      type: wat
`,
      "/virtual/shared.yaml": `${header31}paths: {}
components:
  schemas:
    Base:
      type: string
`,
    });
    expect(
      byRule(diagnostics, "structure/schema-nullable").some((d) => d.message.includes("wat")),
    ).toBe(true);
  });
});

describe("issue #103: example validation evaluates $ref siblings", () => {
  test("3.1 validates a schema-level example against a sibling constraint", async () => {
    const diagnostics = await lintFiles({
      "/virtual/entry.yaml": `${header31}paths: {}
components:
  schemas:
    Base:
      type: string
    Derived:
      $ref: '#/components/schemas/Base'
      maxLength: 3
      example: "toolong"
`,
    });
    const match = byRule(diagnostics, "examples/schema-match");
    expect(match.some((d) => d.message.includes("maxLength"))).toBe(true);
  });

  test("3.1 still validates the example against the referenced target constraint", async () => {
    const diagnostics = await lintFiles({
      "/virtual/entry.yaml": `${header31}paths: {}
components:
  schemas:
    Base:
      type: integer
    Derived:
      $ref: '#/components/schemas/Base'
      minimum: 0
      example: "not-an-integer"
`,
    });
    const match = byRule(diagnostics, "examples/schema-match");
    // The target constraint (type: integer) must still be evaluated against the example.
    expect(match.some((d) => d.message.includes("expected type"))).toBe(true);
  });
});
