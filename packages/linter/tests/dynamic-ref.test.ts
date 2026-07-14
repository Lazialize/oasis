import { expect, test } from "bun:test";
import { InMemoryFileSystem, loadWorkspaceGraph } from "@oasis/core";
import { resolveConfig } from "../src/config.ts";
import { lint } from "../src/engine.ts";

test("refs/no-unresolved validates a 3.1 $dynamicRef static fallback", async () => {
  const entry = "/virtual/entry.yaml";
  const graph = await loadWorkspaceGraph(new InMemoryFileSystem({
    [entry]: [
      "openapi: 3.1.0",
      "info: { title: t, version: '1' }",
      "paths: {}",
      "components:",
      "  schemas:",
      "    Root:",
      "      $dynamicAnchor: node",
      "      properties:",
      "        valid: { $dynamicRef: '#node' }",
      "        invalid: { $dynamicRef: '#missing' }",
    ].join("\n"),
  }), entry);

  const unresolved = lint(graph, resolveConfig(undefined)).filter((diagnostic) => diagnostic.rule === "refs/no-unresolved");
  expect(unresolved).toHaveLength(1);
  expect(unresolved[0]?.message).toContain('anchor "#missing" not found');
  expect(unresolved[0]?.range).toMatchObject({ filePath: entry, start: { line: 9 } });
});
