import { expect, test } from "bun:test";
import { allDiagnostics, InMemoryFileSystem, loadWorkspaceGraph } from "@oasis/core";
import { bundle } from "../src/index.ts";

test("#90 reserved names in named maps bundle to a self-contained document", async () => {
  const entry = "/virtual/entry.yaml";
  const fs = new InMemoryFileSystem({
    [entry]: [
      "openapi: 3.1.0",
      "info: { title: t, version: '1' }",
      "paths: {}",
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

  const result = bundle(await loadWorkspaceGraph(fs, entry));

  expect(result.diagnostics).toEqual([]);
  expect(result.output).not.toContain("schemas.yaml");
  expect(result.output).not.toContain("items.yaml");
  expect(result.output).toContain("dependentSchemas:");
  expect(result.output).toContain("pathItems:");
  expect(result.output).toContain("webhooks:");

  const bundledGraph = await loadWorkspaceGraph(
    new InMemoryFileSystem({ "/virtual/bundled.yaml": result.output }),
    "/virtual/bundled.yaml",
  );
  expect(bundledGraph.documents.size).toBe(1);
  expect(allDiagnostics(bundledGraph).filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
});
