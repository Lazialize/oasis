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
