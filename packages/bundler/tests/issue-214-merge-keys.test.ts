import { describe, expect, test } from "bun:test";
import { parse as yamlParse } from "yaml";
import { InMemoryFileSystem, loadWorkspaceGraph, parseDocument } from "@oasis/core";
import { bundle } from "../src/index.ts";

const entryPath = "/virtual/entry.yaml";

async function graphFor(files: Record<string, string>) {
  const fs = new InMemoryFileSystem(files);
  return loadWorkspaceGraph(fs, entryPath);
}

// #214: the bundler must materialize YAML merge keys ("<<") into the effective merged mapping
// instead of serializing a literal "<<" property, using the same precedence semantics as core's
// merge-aware `childAt` traversal (packages/core/src/walk.ts).
describe("bundle: YAML merge key (\"<<\") materialization", () => {
  test("a single mapping merge is materialized in both YAML and JSON output", async () => {
    const entry = [
      "openapi: 3.1.0",
      "info: { title: T, version: v }",
      "paths: {}",
      "components:",
      "  schemas:",
      "    Base: &base",
      "      type: object",
      "      properties:",
      "        id: { type: string }",
      "    Derived:",
      "      <<: *base",
      "      description: merged",
    ].join("\n");

    const graph = await graphFor({ [entryPath]: entry });

    const yamlResult = bundle(graph, { format: "yaml" });
    expect(yamlResult.diagnostics).toEqual([]);
    expect(yamlResult.output).not.toContain("<<");
    const outYaml = yamlParse(yamlResult.output) as Record<string, any>;
    expect(outYaml.components.schemas.Derived).toEqual({
      type: "object",
      properties: { id: { type: "string" } },
      description: "merged",
    });

    const jsonResult = bundle(graph, { format: "json" });
    expect(jsonResult.diagnostics).toEqual([]);
    expect(jsonResult.output).not.toContain("<<");
    const outJson = JSON.parse(jsonResult.output) as Record<string, any>;
    expect(outJson.components.schemas.Derived).toEqual({
      type: "object",
      properties: { id: { type: "string" } },
      description: "merged",
    });
  });

  test("an explicit key overrides a merged key regardless of relative order", async () => {
    const entry = [
      "openapi: 3.1.0",
      "info: { title: T, version: v }",
      "paths: {}",
      "components:",
      "  schemas:",
      "    Base: &base",
      "      type: object",
      "      description: from-base",
      "    AfterMerge:",
      "      <<: *base",
      "      description: explicit-after",
      "    BeforeMerge:",
      "      description: explicit-before",
      "      <<: *base",
    ].join("\n");

    const graph = await graphFor({ [entryPath]: entry });
    const result = bundle(graph);
    expect(result.diagnostics).toEqual([]);
    const out = yamlParse(result.output) as Record<string, any>;

    // The explicit key always wins, whether it's declared after or before the merge key.
    expect(out.components.schemas.AfterMerge.description).toBe("explicit-after");
    expect(out.components.schemas.BeforeMerge.description).toBe("explicit-before");
    expect(out.components.schemas.AfterMerge.type).toBe("object");
    expect(out.components.schemas.BeforeMerge.type).toBe("object");
  });

  test("a nested merge source (itself using \"<<\") is fully materialized", async () => {
    const entry = [
      "openapi: 3.1.0",
      "info: { title: T, version: v }",
      "paths: {}",
      "components:",
      "  schemas:",
      "    Root: &root",
      "      type: object",
      "      description: root-level",
      "    Mid: &mid",
      "      <<: *root",
      "      x-mid: true",
      "    Leaf:",
      "      <<: *mid",
      "      x-leaf: true",
    ].join("\n");

    const graph = await graphFor({ [entryPath]: entry });
    const result = bundle(graph);
    expect(result.diagnostics).toEqual([]);
    const out = yamlParse(result.output) as Record<string, any>;

    expect(out.components.schemas.Leaf).toEqual({
      type: "object",
      description: "root-level",
      "x-mid": true,
      "x-leaf": true,
    });
    expect(result.output).not.toContain("<<");
  });

  test("a sequence merge (\"<<: [*a, *b]\") follows first-item-wins precedence", async () => {
    const entry = [
      "openapi: 3.1.0",
      "info: { title: T, version: v }",
      "paths: {}",
      "components:",
      "  schemas:",
      "    A: &a",
      "      type: object",
      "      description: from-a",
      "      x-a: true",
      "    B: &b",
      "      description: from-b",
      "      x-b: true",
      "    Combined:",
      "      <<: [*a, *b]",
    ].join("\n");

    const graph = await graphFor({ [entryPath]: entry });
    const result = bundle(graph);
    expect(result.diagnostics).toEqual([]);
    const out = yamlParse(result.output) as Record<string, any>;

    // "description" is defined by both A and B; the earliest sequence item (A) wins.
    expect(out.components.schemas.Combined).toEqual({
      type: "object",
      description: "from-a",
      "x-a": true,
      "x-b": true,
    });
  });

  test("a cyclic self-referential merge does not hang the bundler", async () => {
    const entry = [
      "openapi: 3.1.0",
      "info: { title: T, version: v }",
      "paths: {}",
      "components:",
      "  schemas:",
      "    Node: &node",
      "      <<: *node",
      "      keep: 1",
    ].join("\n");

    const graph = await graphFor({ [entryPath]: entry });
    const result = bundle(graph);
    // Terminates and produces output; the self-merge contributes nothing extra, "keep" survives.
    expect(result.output.length).toBeGreaterThan(0);
    const out = yamlParse(result.output) as Record<string, any>;
    expect(out.components.schemas.Node.keep).toBe(1);
    expect(result.output).not.toContain("<<");
    expect(() => parseDocument(result.output, "/virtual/out.yaml")).not.toThrow();
  });

  test("a $ref reachable only through a merged value is lifted like any other reference", async () => {
    const entry = [
      "openapi: 3.1.0",
      "info: { title: T, version: v }",
      "paths: {}",
      "components:",
      "  schemas:",
      "    Base: &base",
      "      type: object",
      "      properties:",
      "        pet:",
      "          $ref: './pet.yaml#/Pet'",
      "    Derived:",
      "      <<: *base",
      "      description: merged",
    ].join("\n");
    const pet = ["Pet:", "  type: object", "  properties: { name: { type: string } }"].join("\n");

    const graph = await graphFor({ [entryPath]: entry, "/virtual/pet.yaml": pet });
    const result = bundle(graph);
    expect(result.diagnostics.filter((d) => d.code === "no-unresolved-ref")).toEqual([]);
    expect(result.output).not.toContain("pet.yaml");
    const out = yamlParse(result.output) as Record<string, any>;

    expect(out.components.schemas.Pet).toBeDefined();
    expect(out.components.schemas.Derived.properties.pet.$ref).toBe("#/components/schemas/Pet");
    expect(out.components.schemas.Derived.description).toBe("merged");
  });
});
