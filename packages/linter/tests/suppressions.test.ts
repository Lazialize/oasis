import { describe, expect, test } from "bun:test";
import { InMemoryFileSystem, loadWorkspaceGraph, NodeFileSystem } from "@oasis/core";
import { lint } from "../src/engine.ts";
import { resolveConfig } from "../src/config.ts";

const fixturesRoot = `${import.meta.dir}/fixtures/suppressions`;

async function lintFixture(relativePath: string) {
  const fs = new NodeFileSystem();
  const entry = `${fixturesRoot}/${relativePath}`;
  const graph = await loadWorkspaceGraph(fs, entry);
  const config = resolveConfig(undefined);
  return lint(graph, config);
}

describe("oasis-disable-next-line", () => {
  test("suppresses a single named rule only for the line right after the comment", async () => {
    const diagnostics = await lintFixture("next-line-single.yaml");
    const tagDiagnostics = diagnostics.filter((d) => d.rule === "operation-tags");
    expect(tagDiagnostics).toHaveLength(1);
    expect(tagDiagnostics[0]?.message).toContain("/b");
  });

  test("comma-separated and space-separated rule lists both suppress multiple rules", async () => {
    const diagnostics = await lintFixture("next-line-multiple.yaml");
    const relevant = diagnostics.filter((d) => d.rule === "operation-tags" || d.rule === "operation-description");
    // Only the untouched /none-suppressed operation should still report (tags + description = 2).
    expect(relevant).toHaveLength(2);
    expect(relevant.every((d) => d.message.includes("/none-suppressed"))).toBe(true);
  });

  test("no rule names suppresses every rule on that line", async () => {
    const diagnostics = await lintFixture("next-line-none.yaml");
    const forSuppressed = diagnostics.filter((d) => d.message.includes("/suppressed") && !d.message.includes("/not-suppressed"));
    expect(forSuppressed).toEqual([]);

    // The untouched operation still reports operation-tags, operation-description and operation-operationId.
    const forNotSuppressed = diagnostics.filter((d) => d.message.includes("/not-suppressed"));
    const rulesReported = new Set(forNotSuppressed.map((d) => d.rule));
    expect(rulesReported).toEqual(new Set(["operation-tags", "operation-description", "operation-operationId"]));
  });

  test("directive placed before a multi-line node still targets it by its start line", async () => {
    // operation-tags/operation-description report on the whole operation node, whose range starts
    // at its first property (operationId here), not at the "get:" line above it — so the
    // next-line directive has to sit immediately above that first property to suppress it. The
    // node itself still spans several lines (operationId, description, responses).
    const diagnostics = await lintFixture("next-line-single.yaml");
    expect(diagnostics.some((d) => d.rule === "operation-tags" && d.message.includes("/a"))).toBe(false);
  });
});

describe("oasis-disable-file", () => {
  test("suppresses a named rule everywhere in the file", async () => {
    const diagnostics = await lintFixture("file-level.yaml");
    expect(diagnostics.some((d) => d.rule === "operation-tags")).toBe(false);
    // operation-description isn't suppressed and still fires for both operations.
    expect(diagnostics.filter((d) => d.rule === "operation-description")).toHaveLength(2);
  });

  test("no rule names suppresses every rule in the file", async () => {
    const diagnostics = await lintFixture("file-level-all.yaml");
    expect(diagnostics).toEqual([]);
  });

  test("only suppresses the $ref'd file it appears in, not the entry document", async () => {
    const diagnostics = await lintFixture("multifile/entry.yaml");
    const tagDiagnostics = diagnostics.filter((d) => d.rule === "operation-tags");
    expect(tagDiagnostics).toHaveLength(1);
    expect(tagDiagnostics[0]?.range.filePath).toContain("entry.yaml");
    expect(tagDiagnostics[0]?.message).toContain("/entry");
  });
});

describe("syntax errors", () => {
  test("are not suppressible even with a file-level suppress-all directive", async () => {
    const mem = new InMemoryFileSystem({
      "/virtual/entry.yaml": "# oasis-disable-file\nopenapi: 3.0.3\ninfo: [unterminated\n",
    });
    const graph = await loadWorkspaceGraph(mem, "/virtual/entry.yaml");
    const config = resolveConfig(undefined);
    const diagnostics = lint(graph, config);
    expect(diagnostics.some((d) => d.rule === "syntax-error")).toBe(true);
  });
});
