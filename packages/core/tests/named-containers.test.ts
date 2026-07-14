import { describe, expect, test } from "bun:test";
import { allDiagnostics, loadWorkspaceGraph } from "../src/graph.ts";
import { InMemoryFileSystem } from "../src/filesystem.ts";
import { buildAnchorIndex } from "../src/anchor.ts";
import { findRefs } from "../src/ref.ts";
import {
  isNamedEntryContainer,
  NAMED_ENTRY_CONTAINER_KEYS,
  NAMED_ENTRY_CONTAINER_KEYS_31,
} from "../src/named-containers.ts";
import { parseDocument } from "../src/parse.ts";

const ENTRY = "/virtual/entry.yaml";

describe("named-entry container traversal (issue #90)", () => {
  test("the shared catalog gates 3.1-only maps by document version", () => {
    const map = parseDocument("{}", ENTRY).yamlDoc.contents!;

    for (const key of NAMED_ENTRY_CONTAINER_KEYS) {
      expect(isNamedEntryContainer(key, map, "3.0")).toBe(true);
      expect(isNamedEntryContainer(key, map, "3.1")).toBe(true);
    }
    for (const key of NAMED_ENTRY_CONTAINER_KEYS_31) {
      expect(isNamedEntryContainer(key, map, "3.0")).toBe(false);
      expect(isNamedEntryContainer(key, map, "3.1")).toBe(true);
    }
  });

  test("reserved entry names remain real refs in OpenAPI and JSON Schema named maps", async () => {
    const fs = new InMemoryFileSystem({
      [ENTRY]: [
        "openapi: 3.1.0",
        "components:",
        "  schemas:",
        "    Matrix:",
        "      properties:",
        "        default: { $ref: './schemas.yaml#/Property' }",
        "      patternProperties:",
        "        example: { $ref: './schemas.yaml#/Pattern' }",
        "      dependentSchemas:",
        "        enum: { $ref: './schemas.yaml#/Dependent' }",
        "      $defs:",
        "        const: { $ref: './schemas.yaml#/Definition' }",
        "  pathItems:",
        "    default: { $ref: './items.yaml#/Item' }",
        "webhooks:",
        "  example: { $ref: './items.yaml#/Webhook' }",
      ].join("\n"),
      "/virtual/schemas.yaml": [
        "Property: { type: string }",
        "Pattern: { type: string }",
        "Dependent: { type: object }",
        "Definition: { type: integer }",
      ].join("\n"),
      "/virtual/items.yaml": [
        "Item: { get: { responses: { '200': { description: ok } } } }",
        "Webhook: { post: { responses: { '200': { description: ok } } } }",
      ].join("\n"),
    });

    const graph = await loadWorkspaceGraph(fs, ENTRY);
    const refs = findRefs(graph.documents.get(ENTRY)!).map((ref) => ref.value);

    expect(graph.documents.size).toBe(3);
    expect(allDiagnostics(graph)).toEqual([]);
    expect(refs).toHaveLength(6);
    expect(refs).toContain("./schemas.yaml#/Dependent");
    expect(refs).toContain("./items.yaml#/Item");
    expect(refs).toContain("./items.yaml#/Webhook");
  });

  test("anchors under reserved named entries remain indexed", async () => {
    const fs = new InMemoryFileSystem({
      [ENTRY]: [
        "openapi: 3.1.0",
        "components:",
        "  schemas:",
        "    Matrix:",
        "      properties:",
        "        default: { $anchor: PropertyAnchor, type: string }",
        "      patternProperties:",
        "        example: { $anchor: PatternAnchor, type: string }",
        "      dependentSchemas:",
        "        enum: { $anchor: DependentAnchor, type: object }",
        "      $defs:",
        "        const: { $anchor: DefAnchor, type: integer }",
      ].join("\n"),
    });
    const graph = await loadWorkspaceGraph(fs, ENTRY);
    const index = buildAnchorIndex(graph.documents.get(ENTRY)!);

    expect([...index.byName.keys()].sort()).toEqual([
      "DefAnchor",
      "DependentAnchor",
      "PatternAnchor",
      "PropertyAnchor",
    ]);
    for (const entry of index.entries) expect(entry.range.filePath).toBe(ENTRY);
  });
});
