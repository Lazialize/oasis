import { expect, test } from "bun:test";
import { InMemoryFileSystem, loadWorkspaceGraph } from "@oasis/core";
import { resolveConfig } from "../src/config.ts";
import { lint } from "../src/engine.ts";
import { exampleSchemaMatch } from "../src/rules/examples-schema-match.ts";

test("refs/no-unresolved uses the referring schema resource base", async () => {
  const entry = "/api/entry.yaml";
  const graph = await loadWorkspaceGraph(new InMemoryFileSystem({
    [entry]: [
      "openapi: 3.1.0",
      "components:",
      "  schemas:",
      "    Root:",
      "      $id: scoped/root.json",
      "      $ref: child.yaml",
    ].join("\n"),
    "/api/scoped/child.yaml": "type: string\n",
  }), entry);

  const unresolved = lint(graph, resolveConfig(undefined))
    .filter((diagnostic) => diagnostic.rule === "refs/no-unresolved");
  expect(unresolved).toEqual([]);
});

test("examples/schema-match follows a schema ref from its $id resource", async () => {
  const entry = "/api/entry.yaml";
  const graph = await loadWorkspaceGraph(new InMemoryFileSystem({
    [entry]: [
      "openapi: 3.1.0",
      "info: { title: t, version: '1' }",
      "x-child-ref: &childRef child.yaml",
      "paths: {}",
      "components:",
      "  schemas:",
      "    Root:",
      "      $id: scoped/root.json",
      "      $ref: *childRef",
      "      example: 42",
    ].join("\n"),
    "/api/scoped/child.yaml": "type: string\n",
  }), entry);

  const ruleList = [exampleSchemaMatch];
  const diagnostics = lint(graph, resolveConfig(undefined, ruleList), {}, ruleList)
    .filter((diagnostic) => diagnostic.rule === "examples/schema-match");
  expect(diagnostics).toHaveLength(1);
  expect(diagnostics[0]?.message).toContain('expected type "string"');
});
