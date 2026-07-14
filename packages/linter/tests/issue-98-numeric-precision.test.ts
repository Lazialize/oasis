import { describe, expect, test } from "bun:test";
import { InMemoryFileSystem, loadWorkspaceGraph } from "@oasis/core";
import { lint } from "../src/engine.ts";
import { resolveConfig } from "../src/config.ts";

const ENTRY = "/virtual/entry.yaml";

async function lintDoc(source: string) {
  const fs = new InMemoryFileSystem({ [ENTRY]: source });
  const graph = await loadWorkspaceGraph(fs, ENTRY);
  return lint(graph, resolveConfig(undefined));
}

const BASE = `openapi: 3.1.0
info:
  title: t
  version: "1"
paths: {}
components:
  schemas:
`;

describe("issue-98: linter tolerates numeric literals beyond Number precision", () => {
  test("a large-integer bound is still recognized as a number (no spurious type error)", async () => {
    const diagnostics = await lintDoc(`${BASE}    Big:
      type: integer
      minimum: 9007199254740993
      maximum: 92233720368547758070
      multipleOf: 100000000000000001
`);
    const schemaKeyword = diagnostics.filter((d) => d.rule === "structure/schema-keywords");
    expect(schemaKeyword).toEqual([]);
  });

  test("a high-precision decimal bound is still recognized as a number", async () => {
    const diagnostics = await lintDoc(`${BASE}    Precise:
      type: number
      minimum: 0.12345678901234567890123
      maximum: 3.14159265358979323846264338327950288
`);
    const schemaKeyword = diagnostics.filter((d) => d.rule === "structure/schema-keywords");
    expect(schemaKeyword).toEqual([]);
  });

  test("min > max is still detected at large magnitudes", async () => {
    const diagnostics = await lintDoc(`${BASE}    Bad:
      type: integer
      minimum: 90071992547409930
      maximum: 9007199254740993
`);
    const consistency = diagnostics.find(
      (d) => d.rule === "structure/schema-keywords" && d.message.includes("is greater than"),
    );
    expect(consistency).toBeDefined();
  });
});
