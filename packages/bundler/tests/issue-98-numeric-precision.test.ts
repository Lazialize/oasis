import { describe, expect, test } from "bun:test";
import { InMemoryFileSystem, loadWorkspaceGraph } from "@oasis/core";
import { bundle } from "../src/index.ts";

const ENTRY = "/virtual/entry.yaml";

async function bundleDoc(source: string, format: "yaml" | "json") {
  const fs = new InMemoryFileSystem({ [ENTRY]: source });
  const graph = await loadWorkspaceGraph(fs, ENTRY);
  return bundle(graph, { format });
}

const BASE = `openapi: 3.1.0
info:
  title: t
  version: "1"
paths: {}
components:
  schemas:
`;

describe("issue-98: preserve numeric literals beyond Number precision", () => {
  test("preserves an integer above MAX_SAFE_INTEGER in YAML output", async () => {
    const doc = `${BASE}    Id:
      type: integer
      const: 9007199254740993
`;
    const result = await bundleDoc(doc, "yaml");
    expect(result.diagnostics).toEqual([]);
    expect(result.output).toContain("const: 9007199254740993");
    expect(result.output).not.toContain("9007199254740992");
  });

  test("preserves an integer above MAX_SAFE_INTEGER in JSON output (no throw, no quotes)", async () => {
    const doc = `${BASE}    Id:
      type: integer
      const: 9007199254740993
`;
    const result = await bundleDoc(doc, "json");
    expect(result.diagnostics).toEqual([]);
    expect(result.output).toContain('"const": 9007199254740993');
    // must stay a JSON number, not a quoted string
    expect(result.output).not.toContain('"9007199254740993"');
    expect(result.output).not.toContain("9007199254740992");
    // valid JSON overall (BigInt-style value must not break serialization)
    expect(() => JSON.parse(result.output)).not.toThrow();
  });

  test("preserves a large int64 example / default / bound / multipleOf", async () => {
    const doc = `${BASE}    Big:
      type: integer
      default: 9223372036854775807
      example: 9223372036854775806
      minimum: 9223372036854775801
      maximum: 9223372036854775805
      multipleOf: 100000000000000001
`;
    const result = await bundleDoc(doc, "yaml");
    expect(result.output).toContain("default: 9223372036854775807");
    expect(result.output).toContain("example: 9223372036854775806");
    expect(result.output).toContain("minimum: 9223372036854775801");
    expect(result.output).toContain("maximum: 9223372036854775805");
    expect(result.output).toContain("multipleOf: 100000000000000001");
  });

  test("preserves a high-precision decimal literal by value", async () => {
    const doc = `${BASE}    Pi:
      type: number
      const: 3.14159265358979323846264338327950288
`;
    const result = await bundleDoc(doc, "yaml");
    expect(result.output).toContain("const: 3.14159265358979323846264338327950288");
  });

  test("preserves an exponent-form high-precision decimal", async () => {
    const doc = `${BASE}    E:
      type: number
      const: 1.234567890123456789e-10
`;
    const result = await bundleDoc(doc, "yaml");
    expect(result.output).toContain("1.234567890123456789e-10");
  });

  test("preserves exact numbers inside arbitrary extension data", async () => {
    const doc = `${BASE}    X:
      type: object
      x-vendor:
        big: 9007199254740993
        precise: 0.12345678901234567890123
`;
    const result = await bundleDoc(doc, "yaml");
    expect(result.output).toContain("big: 9007199254740993");
    expect(result.output).toContain("precise: 0.12345678901234567890123");
  });

  test("preserves a big number reached through a YAML alias", async () => {
    const doc = `openapi: 3.1.0
info:
  title: t
  version: "1"
paths: {}
components:
  schemas:
    A:
      type: integer
      const: &big 9007199254740993
    B:
      type: integer
      const: *big
`;
    const result = await bundleDoc(doc, "yaml");
    const matches = result.output.match(/9007199254740993/g) ?? [];
    expect(matches.length).toBe(2);
    expect(result.output).not.toContain("9007199254740992");
  });

  test("does not disturb ordinary numbers that round-trip exactly", async () => {
    const doc = `${BASE}    Ok:
      type: number
      minimum: 0
      maximum: 100
      multipleOf: 0.5
      default: 42
`;
    const result = await bundleDoc(doc, "yaml");
    expect(result.output).toContain("minimum: 0");
    expect(result.output).toContain("maximum: 100");
    expect(result.output).toContain("multipleOf: 0.5");
    expect(result.output).toContain("default: 42");
    expect(result.output).not.toContain("OASISPRECISENUMBER");
  });

  test("hex/octal YAML literals bundle to their decimal value in YAML output", async () => {
    const doc = `${BASE}    Flags:
      type: integer
      const: 0x1F
      default: 0o17
`;
    const result = await bundleDoc(doc, "yaml");
    expect(result.diagnostics).toEqual([]);
    expect(result.output).toContain("const: 31");
    expect(result.output).toContain("default: 15");
    expect(result.output).not.toContain("0x1F");
    expect(result.output).not.toContain("0o17");
  });

  test("hex YAML literal bundles to a valid decimal JSON number", async () => {
    const doc = `${BASE}    Flags:
      type: integer
      const: 0x1F
`;
    const result = await bundleDoc(doc, "json");
    expect(result.output).toContain('"const": 31');
    expect(result.output).not.toContain("0x1F");
    expect(() => JSON.parse(result.output)).not.toThrow();
  });

  test("a document string resembling a placeholder token does not corrupt output", async () => {
    const doc = `${BASE}    Weird:
      type: integer
      const: 9007199254740993
      description: OASISPRECISENUMBER0PRESERVEDEND
`;
    const result = await bundleDoc(doc, "yaml");
    expect(result.output).toContain("const: 9007199254740993");
    expect(result.output).toContain("description: OASISPRECISENUMBER0PRESERVEDEND");
  });

  test("JSON output preserves a high-precision decimal as an unquoted number", async () => {
    const doc = `${BASE}    Pi:
      type: number
      const: 3.14159265358979323846264338327950288
`;
    const result = await bundleDoc(doc, "json");
    expect(result.output).toContain('"const": 3.14159265358979323846264338327950288');
    expect(result.output).not.toContain('"3.14159265358979323846264338327950288"');
  });
});
