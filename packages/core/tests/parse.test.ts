import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseDocument } from "../src/parse.ts";
import { nodeAtPointer } from "../src/document.ts";

const fixturesDir = `${import.meta.dir}/fixtures/misc`;

describe("parseDocument (YAML)", () => {
  const text = readFileSync(`${fixturesDir}/small.yaml`, "utf-8");
  const doc = parseDocument(text, `${fixturesDir}/small.yaml`);

  test("parses without diagnostics", () => {
    expect(doc.diagnostics).toEqual([]);
  });

  test("exact range for a top-level scalar value", () => {
    const result = nodeAtPointer(doc, "/foo");
    expect(result).toBeDefined();
    expect(result?.range.start).toEqual({ line: 0, character: 5 });
    expect(result?.range.end).toEqual({ line: 0, character: 8 });
  });

  test("exact range for a nested key's value", () => {
    const result = nodeAtPointer(doc, "/nested/baz");
    expect(result).toBeDefined();
    expect(result?.range.start).toEqual({ line: 2, character: 7 });
    expect(result?.range.end).toEqual({ line: 2, character: 8 });
  });
});

describe("parseDocument (JSON, via yaml superset parsing)", () => {
  const text = readFileSync(`${fixturesDir}/small.json`, "utf-8");
  const doc = parseDocument(text, `${fixturesDir}/small.json`);

  test("parses without diagnostics", () => {
    expect(doc.diagnostics).toEqual([]);
  });

  test("pointer lookups produce correct values with tracked positions", () => {
    const foo = nodeAtPointer(doc, "/foo");
    expect(foo).toBeDefined();
    expect(foo?.range.start.line).toBe(1);

    const baz = nodeAtPointer(doc, "/nested/baz");
    expect(baz).toBeDefined();
    expect(baz?.range.start.line).toBe(3);
  });
});

describe("duplicate key detection", () => {
  const text = readFileSync(`${fixturesDir}/duplicate.yaml`, "utf-8");
  const doc = parseDocument(text, `${fixturesDir}/duplicate.yaml`);

  test("reports one diagnostic per duplicate key", () => {
    const dupDiagnostics = doc.diagnostics.filter((d) => d.code === "no-duplicate-keys");
    expect(dupDiagnostics).toHaveLength(2);
    expect(dupDiagnostics.every((d) => d.severity === "error")).toBe(true);
    expect(dupDiagnostics[0]?.message).toContain("foo");
    expect(dupDiagnostics[1]?.message).toContain("bar");
  });
});

describe("leading BOM handling", () => {
  test("a BOM is stripped so first-line columns match what editors display", () => {
    const doc = parseDocument('﻿openapi: 3.0.3\ninfo:\n  title: T\n', "/virtual/bom.yaml");
    expect(doc.text.startsWith("﻿")).toBe(false);
    const openapi = nodeAtPointer(doc, "/openapi");
    expect(openapi).toBeDefined();
    // "openapi: " is 9 characters; without stripping, the BOM shifted this to 10.
    expect(openapi?.range.start.line).toBe(0);
    expect(openapi?.range.start.character).toBe(9);
  });
});
