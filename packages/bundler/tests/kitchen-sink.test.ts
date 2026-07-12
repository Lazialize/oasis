import { describe, expect, test } from "bun:test";
import { InMemoryFileSystem, loadWorkspaceGraph, NodeFileSystem } from "@oasis/core";
import { lint, resolveConfig } from "@oasis/linter";
import { bundle } from "../src/index.ts";

// Reuses the linter package's multi-file kitchen-sink fixtures (crafted to be fully valid) as a
// bundler smoke test: bundle the multi-file entry, assert the output is a self-contained document
// with zero unresolved refs, and re-lint it with zero structure/* errors.
const kitchenSinkRoot = `${import.meta.dir}/../../linter/tests/fixtures/real-world/kitchen-sink`;

describe("bundle: kitchen-sink corpus", () => {
  for (const version of ["30", "31"] as const) {
    test(`${version}/entry.yaml: bundles to a self-contained, zero-unresolved-ref, zero structure/* error document`, async () => {
      const fs = new NodeFileSystem();
      const graph = await loadWorkspaceGraph(fs, `${kitchenSinkRoot}/${version}/entry.yaml`);
      const result = bundle(graph);
      expect(result.diagnostics).toEqual([]);
      expect(result.output).not.toContain("shared.yaml");

      const bundledPath = "/virtual/bundled.yaml";
      const bundledFs = new InMemoryFileSystem({ [bundledPath]: result.output });
      const bundledGraph = await loadWorkspaceGraph(bundledFs, bundledPath);
      expect(bundledGraph.documents.size).toBe(1); // no external files pulled in

      const diagnostics = lint(bundledGraph, resolveConfig({ lint: { rules: { "components/no-unused": "off" } } }));
      const unresolvedRefs = diagnostics.filter((d) => d.rule === "refs/no-unresolved");
      expect(unresolvedRefs).toEqual([]);
      const structureErrors = diagnostics.filter((d) => d.rule.startsWith("structure/") && d.severity === "error");
      expect(structureErrors).toEqual([]);
    });
  }
});
