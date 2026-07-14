import { expect, test } from "bun:test";
import { InMemoryFileSystem, loadWorkspaceGraph } from "@oasis/core";
import { bundle } from "../src/bundle.ts";

test("bundle preserves local $dynamicRef and diagnoses every external dependency", async () => {
  const entry = "/virtual/entry.yaml";
  const graph = await loadWorkspaceGraph(new InMemoryFileSystem({
    [entry]: [
      "openapi: 3.1.0",
      "info: { title: t, version: '1' }",
      "x-tree-uri: &treeUri './tree.yaml#/Tree'",
      "paths: {}",
      "components:",
      "  schemas:",
      "    Root:",
      "      $dynamicAnchor: node",
      "      properties:",
      "        local: { $dynamicRef: '#node' }",
      "        child: { $dynamicRef: *treeUri }",
      "    Lifted: { $ref: './relocated.yaml#/Tree' }",
    ].join("\n"),
    "/virtual/tree.yaml": "Tree: { type: object }\n",
    "/virtual/relocated.yaml": [
      "Tree:",
      "  $dynamicAnchor: node",
      "  properties:",
      "    child: { $dynamicRef: '#node' }",
    ].join("\n"),
  }), entry);

  const result = bundle(graph);
  expect(result.output).toContain('$dynamicRef: "#node"');
  expect(result.output).toContain("$dynamicRef: ./tree.yaml#/Tree");
  expect(result.diagnostics).toHaveLength(2);
  expect(result.diagnostics.find((diagnostic) => diagnostic.range.filePath === entry)).toMatchObject({
    code: "unsupported-dynamic-ref",
    severity: "warning",
    range: { filePath: entry, start: { line: 2 } },
  });
  expect(result.diagnostics.find((diagnostic) => diagnostic.range.filePath === "/virtual/relocated.yaml")).toMatchObject({
    code: "unsupported-dynamic-ref",
    severity: "warning",
    range: { filePath: "/virtual/relocated.yaml", start: { line: 3 } },
  });
  expect(result.diagnostics.every((diagnostic) => diagnostic.message.includes("cannot be safely relocated"))).toBe(true);
});
