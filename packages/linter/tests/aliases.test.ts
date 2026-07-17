import { expect, test } from "bun:test";
import { InMemoryFileSystem, loadWorkspaceGraph, nodeAtPointer } from "@oasis/core";
import { lint } from "../src/engine.ts";
import {
  collectParameterObjects,
  iterateOperations,
  iterateSchemas,
  walkSchemaTree,
} from "../src/openapi-walk.ts";
import { resolveConfig } from "../src/config.ts";

test("#104 aliases and merge keys preserve general OpenAPI lint traversal", async () => {
  const entry = "/virtual/entry.yaml";
  const fs = new InMemoryFileSystem({
    [entry]: [
      "openapi: 3.1.0",
      "info: { title: t, version: '1' }",
      "x-path-item: &sharedPath",
      "  get: &sharedOperation",
      "    operationId: shared",
      "    tags: [shared]",
      "    responses:",
      "      '200': { description: ok }",
      "paths:",
      "  /direct: *sharedPath",
      "  /merged:",
      "    <<: *sharedPath",
      "  /operation-direct:",
      "    get: *sharedOperation",
      "  /operation-merged:",
      "    get:",
      "      <<: *sharedOperation",
      "      description: merged operation",
      "  /external: { $ref: './path.yaml#/Item' }",
      "components:",
      "  parameters:",
      "    Base: &parameter",
      "      name: q",
      "      in: query",
      "      schema: { type: string }",
      "    Copy: *parameter",
      "    Merged:",
      "      <<: *parameter",
      "  schemas:",
      "    Base: &schema",
      "      type: object",
      "      properties:",
      "        name: &nameSchema { type: string }",
      "        alias: *nameSchema",
      "    Copy: *schema",
      "    Merged:",
      "      <<: *schema",
      "tags: [{ name: shared }]",
    ].join("\n"),
    "/virtual/path.yaml": [
      "Operation: &operation",
      "  operationId: external",
      "  tags: [shared]",
      "  description: external operation",
      "  responses:",
      "    '200': { description: ok }",
      "Base: &pathItem",
      "  get: *operation",
      "Merged: &mergedPathItem",
      "  <<: *pathItem",
      "Item:",
      "  <<: *mergedPathItem",
    ].join("\n"),
  });
  const graph = await loadWorkspaceGraph(fs, entry);
  const entryDoc = graph.documents.get(entry)!;
  const documents = [...graph.documents.values()];

  const operations = iterateOperations(graph, entryDoc, "3.1");
  expect(operations).toHaveLength(5);
  expect(operations.map((operation) => operation.node.range)).toContainEqual(
    nodeAtPointer(entryDoc, "/x-path-item/get")?.node.range,
  );
  expect(operations.find((operation) => operation.doc.filePath === "/virtual/path.yaml")).toBeDefined();

  const parameters = collectParameterObjects(graph, entryDoc, documents, "3.1");
  expect(parameters).toHaveLength(3);
  expect(parameters[0]?.node.range).toEqual(parameters[1]?.node.range);
  expect(nodeAtPointer(entryDoc, "/components/parameters/Merged/name")?.node.range).toEqual(
    nodeAtPointer(entryDoc, "/components/parameters/Base/name")?.node.range,
  );

  const schemaSites = iterateSchemas(graph, entryDoc, documents, "3.1");
  const aliasedSchema = schemaSites.find((site) => site.pointer === "/components/schemas/Copy");
  expect(aliasedSchema?.node.range).toEqual(nodeAtPointer(entryDoc, "/components/schemas/Base")?.node.range);
  expect(nodeAtPointer(entryDoc, "/components/schemas/Merged/properties")?.node.range).toEqual(
    nodeAtPointer(entryDoc, "/components/schemas/Base/properties")?.node.range,
  );
  const nested: unknown[] = [];
  walkSchemaTree(aliasedSchema!.node, (schema) => nested.push(schema), "3.1");
  expect(nested).toHaveLength(2);

  const diagnostics = lint(graph, resolveConfig(undefined));
  expect(diagnostics.filter((diagnostic) => diagnostic.rule === "structure/field-types")).toEqual([]);
  const descriptions = diagnostics.filter((diagnostic) => diagnostic.rule === "operation/description");
  expect(descriptions).toHaveLength(3);
  for (const diagnostic of descriptions) {
    expect(diagnostic.range.filePath).toBe(entry);
    expect(diagnostic.range.start.line).toBe(4);
  }
});

test("scalar aliases retain $ref resolution, example validation, and discriminator mapping semantics", async () => {
  const entry = "/virtual/entry.yaml";
  const graph = await loadWorkspaceGraph(new InMemoryFileSystem({
    [entry]: [
      "openapi: 3.0.3",
      "info: { title: t, version: '1' }",
      "x-schema-uri: &schemaUri './schemas.yaml#/Thing'",
      "x-dog-uri: &dogUri './schemas.yaml#/Dog'",
      "paths:",
      "  /thing:",
      "    get:",
      "      operationId: getThing",
      "      responses:",
      "        '200':",
      "          description: ok",
      "          content:",
      "            application/json:",
      "              schema: { $ref: *schemaUri }",
      "              example: wrong",
      "components:",
      "  schemas:",
      "    Pet:",
      "      type: object",
      "      required: [petType]",
      "      properties: { petType: { type: string } }",
      "      discriminator:",
      "        propertyName: petType",
      "        mapping: { dog: *dogUri }",
      "      oneOf:",
      "        - $ref: *dogUri",
    ].join("\n"),
    "/virtual/schemas.yaml": [
      "Thing: { type: integer }",
      "Dog:",
      "  type: object",
      "  required: [petType]",
      "  properties: { petType: { type: string } }",
    ].join("\n"),
  }), entry);

  const diagnostics = lint(graph, resolveConfig(undefined));
  expect(diagnostics.filter((diagnostic) => diagnostic.rule === "examples/schema-match")).toHaveLength(1);
  expect(
    diagnostics.filter((diagnostic) =>
      diagnostic.rule === "structure/discriminator" && diagnostic.message.includes("mapping")
    ),
  ).toEqual([]);
});
