import { describe, expect, test } from "bun:test";
import { loadWorkspaceGraph, NodeFileSystem } from "@oasis/core";
import { parse as parseYaml } from "yaml";
import { bundle } from "../src/index.ts";

const fixturesRoot = `${import.meta.dir}/fixtures`;

async function loadFixture(dir: string, entryFile = "entry.yaml") {
  const fs = new NodeFileSystem();
  return loadWorkspaceGraph(fs, `${fixturesRoot}/${dir}/${entryFile}`);
}

/** Parse bundled output (YAML or JSON) back into a plain JS value for structural assertions. */
function parseOutput(output: string, format: "yaml" | "json"): any {
  return format === "json" ? JSON.parse(output) : parseYaml(output);
}

describe("issue #87: version- and object-specific $ref sibling semantics when dereferencing", () => {
  for (const format of ["yaml", "json"] as const) {
    describe(`${format} output`, () => {
      test("3.0 Reference Object siblings are ignored after dereferencing", async () => {
        const graph = await loadFixture("deref-sibling-30-ref");
        const result = bundle(graph, { dereference: true, format });
        expect(result.diagnostics).toEqual([]);

        const doc = parseOutput(result.output, format);
        const response = doc.paths["/pets"].get.responses["200"];
        // The target's own description wins; the ignored sibling never appears.
        expect(response.description).toBe("target-description");
        expect(result.output).not.toContain("sibling-must-be-ignored");
        expect(response.content["application/json"].schema.type).toBe("object");
        expect(response.$ref).toBeUndefined();
      });

      test("3.1 Schema Object siblings preserve conjunction via allOf (conflicting scalar + array)", async () => {
        const graph = await loadFixture("deref-sibling-31-schema");
        const result = bundle(graph, { dereference: true, format });
        expect(result.diagnostics).toEqual([]);

        const doc = parseOutput(result.output, format);
        const schema = doc.paths["/a"].get.responses["200"].content["application/json"].schema;
        // Conjunction, not last-write-wins: both the target (type:string) and the siblings
        // (type:number, enum) survive as independent allOf branches.
        expect(schema.$ref).toBeUndefined();
        expect(Array.isArray(schema.allOf)).toBe(true);
        expect(schema.allOf).toHaveLength(2);
        const [target, siblings] = schema.allOf;
        expect(target).toEqual({ type: "string", description: "target string schema" });
        expect(siblings).toEqual({ type: "number", enum: [1, 2, 3] });
      });

      test("3.1 Schema Object siblings preserve conjunction with a boolean-schema target", async () => {
        const graph = await loadFixture("deref-sibling-31-schema");
        const result = bundle(graph, { dereference: true, format });
        expect(result.diagnostics).toEqual([]);

        const doc = parseOutput(result.output, format);
        const schema = doc.paths["/b"].get.responses["200"].content["application/json"].schema;
        expect(schema.allOf).toEqual([true, { type: "string" }]);
      });

      test("3.1 Reference Object allows summary/description overrides but ignores other siblings", async () => {
        const graph = await loadFixture("deref-sibling-31-ref");
        const result = bundle(graph, { dereference: true, format });
        expect(result.diagnostics).toEqual([]);

        const doc = parseOutput(result.output, format);
        const response = doc.paths["/pets"].get.responses["200"];
        // summary/description override the target...
        expect(response.summary).toBe("overridden-summary");
        expect(response.description).toBe("overridden-description");
        // ...but a non-allowed sibling (content) is ignored: the target's content is kept.
        expect(response.content["application/json"].schema).toEqual({
          type: "object",
          properties: { name: { type: "string" } },
        });
        expect(response.$ref).toBeUndefined();
      });
    });
  }
});
