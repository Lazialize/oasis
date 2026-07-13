import { describe, expect, test } from "bun:test";
import { InMemoryFileSystem, loadWorkspaceGraph } from "@oasis/core";
import { lint } from "../src/engine.ts";
import { resolveConfig } from "../src/config.ts";

/**
 * Issue #40 matrix: every schema-inspecting rule must reach every JSON Schema applicator position.
 * We use `structure/schema-nullable` (which flags a forbidden `nullable: true` in a 3.1 document)
 * as the probe: a `nullable: true` planted below each applicator must be reported, proving the
 * unified `walkSchemaTree` traverses that position.
 */

async function nullableDiagnosticsAt(applicatorYaml: string): Promise<number> {
  const doc = `
openapi: 3.1.0
info:
  title: Matrix
  version: "1.0.0"
paths: {}
components:
  schemas:
    Probe:
      type: object
${applicatorYaml}
`;
  const fs = new InMemoryFileSystem({ "/virtual/entry.yaml": doc });
  const graph = await loadWorkspaceGraph(fs, "/virtual/entry.yaml");
  const diagnostics = lint(graph, resolveConfig(undefined));
  return diagnostics.filter((d) => d.rule === "structure/schema-nullable").length;
}

// Each entry embeds `nullable: true` (a 3.1 violation) one level below the named applicator.
// `n8`/`n10` are `nullable: true` at 8 / 10 spaces of indentation (a direct schema child vs a
// grandchild under a named-map or sequence entry).
const n8 = "        nullable: true";
const n10 = "          nullable: true";
const applicators: Record<string, string> = {
  properties: `      properties:\n        child:\n${n10}`,
  items: `      items:\n${n8}`,
  additionalProperties: `      additionalProperties:\n${n8}`,
  not: `      not:\n${n8}`,
  allOf: `      allOf:\n        - nullable: true`,
  oneOf: `      oneOf:\n        - nullable: true`,
  anyOf: `      anyOf:\n        - nullable: true`,
  prefixItems: `      prefixItems:\n        - nullable: true`,
  patternProperties: `      patternProperties:\n        "^x-":\n${n10}`,
  if: `      if:\n${n8}`,
  then: `      then:\n${n8}`,
  else: `      else:\n${n8}`,
  contains: `      contains:\n${n8}`,
  propertyNames: `      propertyNames:\n${n8}`,
  dependentSchemas: `      dependentSchemas:\n        other:\n${n10}`,
  $defs: `      $defs:\n        Local:\n${n10}`,
  unevaluatedProperties: `      unevaluatedProperties:\n${n8}`,
  unevaluatedItems: `      unevaluatedItems:\n${n8}`,
  contentSchema: `      contentSchema:\n${n8}`,
};

describe("schema walker matrix (issue #40)", () => {
  for (const [name, yaml] of Object.entries(applicators)) {
    test(`structure/schema-nullable reaches a nested schema under "${name}"`, async () => {
      expect(await nullableDiagnosticsAt(yaml)).toBeGreaterThan(0);
    });
  }

  test("a forbidden nullable below $defs is reported (issue #40 repro)", async () => {
    const count = await nullableDiagnosticsAt(applicators.$defs!);
    expect(count).toBe(1);
  });
});
