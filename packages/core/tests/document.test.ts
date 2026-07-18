import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { isScalar } from "yaml";
import { nodeAtPointer, nodeAtPosition } from "../src/document.ts";
import { parseDocument } from "../src/parse.ts";

const fixturesDir = `${import.meta.dir}/fixtures/misc`;

describe("pointer <-> position round trips", () => {
  const filePath = `${fixturesDir}/pointer.yaml`;
  const text = readFileSync(filePath, "utf-8");
  const doc = parseDocument(text, filePath);

  test("nodeAtPointer resolves an escaped pointer segment", () => {
    const pointer = "/paths/~1users~1{id}/get/summary";
    const result = nodeAtPointer(doc, pointer);
    expect(result).toBeDefined();
    expect(isScalar(result?.node) && result.node.value).toBe("Get user");
  });

  test("nodeAtPointer resolves a non-escaped sibling pointer", () => {
    const result = nodeAtPointer(doc, "/paths/~1users/get/summary");
    expect(isScalar(result?.node) && result?.node.value).toBe("List users");
  });

  test("nodeAtPointer returns undefined for a missing pointer", () => {
    expect(nodeAtPointer(doc, "/paths/~1nope/get")).toBeUndefined();
  });

  test("nodeAtPosition finds the deepest node and its exact pointer", () => {
    const needle = "Get user";
    const offset = text.indexOf(needle) + 1;
    const result = nodeAtPosition(doc, offset);
    expect(result).toBeDefined();
    expect(result?.pointer).toBe("/paths/~1users~1{id}/get/summary");
    expect(isScalar(result?.node) && result?.node.value).toBe("Get user");
  });

  test("position -> pointer -> position round trip stays on the same node", () => {
    const needle = "List users";
    const offset = text.indexOf(needle) + 2;
    const byPosition = nodeAtPosition(doc, offset);
    expect(byPosition).toBeDefined();
    const byPointer = nodeAtPointer(doc, byPosition!.pointer);
    expect(byPointer?.range).toEqual(byPosition!.range);
  });

  test("nodeAtPosition on a map *key* resolves to that pair's pointer, not the containing map", () => {
    // Cursor inside the "summary" key text of "summary: List users" (/paths/~1users/get/summary).
    const keyIdx = text.indexOf("summary: List users");
    expect(keyIdx).toBeGreaterThan(-1);
    const offset = keyIdx + 2; // inside "summary", before the colon

    const result = nodeAtPosition(doc, offset);
    expect(result).toBeDefined();
    expect(result?.pointer).toBe("/paths/~1users/get/summary");
    // Resolves to the pair's value (the scalar "List users"), matching a hit on the value itself.
    expect(isScalar(result?.node) && result?.node.value).toBe("List users");
  });
});

describe("nodeAtPointer is a plain RFC 6901 pointer API (no URI percent-decoding)", () => {
  // A literal percent-escape-looking key ("%7Bid%7D") and a literal-brace key ("{id}") coexist as
  // distinct sibling keys — only a `$ref` fragment's extra percent-encoding layer should ever
  // conflate them (see issue #96).
  const text = [
    "paths:",
    "  /pets/%7Bid%7D:",
    "    get:",
    "      summary: literal percent-escape key",
    "  /pets/{id}:",
    "    get:",
    "      summary: brace key",
  ].join("\n");
  const filePath = `${fixturesDir}/pointer-percent.yaml`;
  const doc = parseDocument(text, filePath);

  test("resolves the literal '%7Bid%7D' key, not the '{id}' key", () => {
    const result = nodeAtPointer(doc, "/paths/~1pets~1%7Bid%7D/get/summary");
    expect(isScalar(result?.node) && result?.node.value).toBe("literal percent-escape key");
  });

  test("resolves the '{id}' key via its own (unescaped) segment", () => {
    const result = nodeAtPointer(doc, "/paths/~1pets~1{id}/get/summary");
    expect(isScalar(result?.node) && result?.node.value).toBe("brace key");
  });

  test("nodeAtPosition -> nodeAtPointer round-trips through a plain, non-percent-encoded pointer", () => {
    const needle = "literal percent-escape key";
    const offset = text.indexOf(needle) + 1;
    const found = nodeAtPosition(doc, offset);
    expect(found).toBeDefined();
    expect(found?.pointer).toBe("/paths/~1pets~1%7Bid%7D/get/summary");
    // No more compensating "%25..." double-encoding in the emitted pointer.
    expect(found?.pointer).not.toContain("%25");

    const byPointer = nodeAtPointer(doc, found!.pointer);
    expect(byPointer?.range).toEqual(found!.range);
  });
});

describe("nodeAtPointer rejects malformed RFC 6901 pointers (issue #152)", () => {
  const filePath = `${fixturesDir}/pointer-rejection.yaml`;
  const doc = parseDocument("foo: bar\n", filePath);

  test("returns undefined for a pointer without leading slash", () => {
    expect(nodeAtPointer(doc, "foo")).toBeUndefined();
  });

  test("returns undefined for a pointer with malformed tilde escape (~2)", () => {
    expect(nodeAtPointer(doc, "/bad~2escape")).toBeUndefined();
  });

  test("returns undefined for a pointer with trailing tilde", () => {
    expect(nodeAtPointer(doc, "/trailing~")).toBeUndefined();
  });

  test("returns undefined for a pointer with tilde not followed by 0 or 1", () => {
    expect(nodeAtPointer(doc, "/bad~x")).toBeUndefined();
  });

  test("returns a result for valid pointer to existing node", () => {
    const result = nodeAtPointer(doc, "/foo");
    expect(result).toBeDefined();
    expect(isScalar(result?.node) && result?.node.value).toBe("bar");
  });

  test("returns undefined for valid pointer to non-existent node", () => {
    expect(nodeAtPointer(doc, "/baz")).toBeUndefined();
  });

  test("returns a result for valid root pointer", () => {
    const result = nodeAtPointer(doc, "");
    expect(result).toBeDefined();
  });
});
