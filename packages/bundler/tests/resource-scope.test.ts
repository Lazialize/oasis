import { expect, test } from "bun:test";
import { allDiagnostics, InMemoryFileSystem, loadWorkspaceGraph } from "@oasis/core";
import { bundle } from "../src/index.ts";

test("bundle preserves refs whose $id resource cannot be safely relocated and diagnoses them", async () => {
  const entry = "/api/entry.yaml";
  const graph = await loadWorkspaceGraph(new InMemoryFileSystem({
    [entry]: [
      "openapi: 3.1.0",
      "info: { title: t, version: '1' }",
      "paths: {}",
      "components:",
      "  schemas:",
      "    Root:",
      "      $id: scoped/root.json",
      "      $ref: child.yaml",
    ].join("\n"),
    "/api/scoped/child.yaml": "type: string\n",
  }), entry);

  const result = bundle(graph);
  expect(result.output).toContain("$ref: child.yaml");
  expect(result.diagnostics).toHaveLength(1);
  expect(result.diagnostics[0]?.code).toBe("unsupported-schema-resource-relocation");

  // The preserved dependency is explicit rather than a silently-invalid rewritten local pointer.
  const bundledGraph = await loadWorkspaceGraph(
    new InMemoryFileSystem({ "/output/bundled.yaml": result.output }),
    "/output/bundled.yaml",
  );
  expect(allDiagnostics(bundledGraph).some((diagnostic) => diagnostic.code === "no-unresolved-ref")).toBe(true);
});

test("bundle distinguishes aliased ref occurrences that have different resource bases", async () => {
  const graph = await loadWorkspaceGraph(new InMemoryFileSystem({
    "/api/entry.yaml": [
      "openapi: 3.1.0",
      "components:",
      "  schemas:",
      "    Shared: &shared",
      "      $ref: target.yaml",
      "    One:",
      "      $id: one/root.json",
      "      $defs: { Use: *shared }",
      "    Two:",
      "      $id: two/root.json",
      "      $defs: { Use: *shared }",
    ].join("\n"),
    "/api/target.yaml": "type: 'null'\n",
    "/api/one/target.yaml": "type: string\n",
    "/api/two/target.yaml": "type: integer\n",
  }), "/api/entry.yaml");

  const result = bundle(graph);
  expect(result.diagnostics.filter((diagnostic) => diagnostic.code === "unsupported-schema-resource-relocation"))
    .toHaveLength(2);
  // Only the physical-document occurrence is lifted. Scoped aliases retain their original ref;
  // they must never be silently rewritten to the physical target's `null` schema.
  expect((result.output.match(/\$ref: target\.yaml/g) ?? [])).toHaveLength(2);
  expect(result.output).toContain('type: "null"');
});
