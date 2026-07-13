import { describe, expect, test } from "bun:test";
import { InMemoryFileSystem, loadWorkspaceGraph, parseDocument } from "@oasis/core";
import { parse as yamlParse } from "yaml";
import { bundle } from "../src/index.ts";

const entryPath = "/virtual/entry.yaml";

async function graphFor(files: Record<string, string>) {
  const fs = new InMemoryFileSystem(files);
  return loadWorkspaceGraph(fs, entryPath);
}

describe("bundle: YAML anchors/aliases", () => {
  test("an aliased component (*base) is not silently dropped from the output", async () => {
    const entry = [
      "openapi: 3.0.0",
      "info: { title: t, version: '1' }",
      "paths: {}",
      "components:",
      "  schemas:",
      "    Base: &base",
      "      type: object",
      "      properties:",
      "        id: { type: string }",
      "    Derived: *base",
    ].join("\n");

    const graph = await graphFor({ [entryPath]: entry });
    const result = bundle(graph);

    const out = yamlParse(result.output) as Record<string, any>;
    expect(out.components.schemas.Derived).toBeDefined();
    expect(out.components.schemas.Derived).toEqual({
      type: "object",
      properties: { id: { type: "string" } },
    });
  });

  test("a $ref that is only reachable through an alias is lifted into the bundle", async () => {
    const entry = [
      "openapi: 3.0.0",
      "info: { title: t, version: '1' }",
      "paths:",
      "  /a:",
      "    get: &op",
      "      responses:",
      "        '200':",
      "          description: ok",
      "          content:",
      "            application/json:",
      "              schema:",
      "                $ref: './shared.yaml#/components/schemas/Pet'",
      "  /b:",
      "    get: *op",
    ].join("\n");
    const shared = [
      "components:",
      "  schemas:",
      "    Pet:",
      "      type: object",
      "      properties: { name: { type: string } }",
    ].join("\n");

    const graph = await graphFor({
      [entryPath]: entry,
      "/virtual/shared.yaml": shared,
    });
    const result = bundle(graph);

    // The alias-reached $ref resolves cleanly (no unresolved-ref diagnostics).
    expect(result.diagnostics.filter((d) => d.code === "no-unresolved-ref")).toEqual([]);
    const out = yamlParse(result.output) as Record<string, any>;
    // Pet lifted into components; both /a and /b reference it internally.
    expect(out.components.schemas.Pet).toBeDefined();
    expect(result.output).not.toContain("shared.yaml");
    // The aliased path item /b is materialized, not dropped.
    expect(out.paths["/b"].get).toBeDefined();
    expect(out.paths["/b"].get.responses["200"].content["application/json"].schema.$ref).toContain("#/components/schemas/Pet");
  });

  test("cyclic alias does not hang the bundler and emits a warning", async () => {
    const entry = [
      "openapi: 3.0.0",
      "info: { title: t, version: '1' }",
      "paths: {}",
      "components:",
      "  schemas:",
      "    Node: &n",
      "      type: object",
      "      properties:",
      "        self: *n",
    ].join("\n");

    const graph = await graphFor({ [entryPath]: entry });
    const result = bundle(graph);
    // Terminates and produces output.
    expect(result.output.length).toBeGreaterThan(0);
    expect(result.diagnostics.some((d) => d.code === "cyclic-alias")).toBe(true);
    // Confirm the output re-parses.
    expect(() => parseDocument(result.output, "/virtual/out.yaml")).not.toThrow();
  });
});
