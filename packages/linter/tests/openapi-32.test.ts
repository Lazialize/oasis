import { describe, expect, test } from "bun:test";
import { InMemoryFileSystem, loadWorkspaceGraph } from "@oasis/core";
import { lint } from "../src/engine.ts";
import { resolveConfig } from "../src/config.ts";

async function lintDocument(source: string) {
  const fs = new InMemoryFileSystem({ "/virtual/entry.yaml": source });
  const graph = await loadWorkspaceGraph(fs, "/virtual/entry.yaml");
  return lint(graph, resolveConfig(undefined));
}

describe("OpenAPI 3.2", () => {
  test("accepts 3.2 operations, components, and object fields", async () => {
    const diagnostics = await lintDocument(`
openapi: 3.2.0
$self: ./entry.yaml
info: { title: T, version: "1" }
servers:
  - name: production
    url: https://example.test
tags:
  - name: events
    summary: Events
    kind: nav
paths:
  /events:
    query:
      operationId: queryEvents
      tags: [events]
      description: Query events.
      parameters:
        - name: query
          in: querystring
          content:
            application/json:
              schema: { type: object }
      responses:
        "200": { summary: Results }
    additionalOperations:
      COPY:
        operationId: copyEvents
        tags: [events]
        description: Copy events.
        responses:
          "200": {}
components:
  mediaTypes:
    EventStream:
      itemSchema: { type: string }
      prefixEncoding:
        - contentType: text/plain
  examples:
    Serialized:
      dataValue: hello
      serializedValue: hello
  securitySchemes:
    device:
      type: oauth2
      oauth2MetadataUrl: https://example.test/.well-known/oauth-authorization-server
      deprecated: false
      flows:
        deviceAuthorization:
          deviceAuthorizationUrl: https://example.test/device
          tokenUrl: https://example.test/token
          scopes: {}
  schemas:
    Other: { type: object }
    Pet:
      type: object
      properties:
        petType: { type: string }
      discriminator:
        propertyName: petType
        defaultMapping: Other
      xml:
        nodeType: element
`);

    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(diagnostics.some((d) => d.rule === "structure/openapi-version")).toBe(false);
  });

  test("keeps query and additionalOperations gated to 3.2", async () => {
    const diagnostics = await lintDocument(`
openapi: 3.1.0
info: { title: T, version: "1" }
paths:
  /events:
    query: {}
    additionalOperations: {}
`);
    const messages = diagnostics.filter((d) => d.rule === "structure/http-methods").map((d) => d.message);
    expect(messages.some((message) => message.includes('"query"'))).toBe(true);
    expect(messages.some((message) => message.includes('"additionalOperations"'))).toBe(true);
  });

  test("resolves Security Requirement URI keys after component-name lookup", async () => {
    const fs = new InMemoryFileSystem({
      "/virtual/entry.yaml": [
        "openapi: 3.2.0",
        "info: { title: T, version: '1' }",
        "paths: {}",
        "security:",
        "  - './security.yaml#/oauth': [read]",
        "  - 'https://security.example/schemes/bearer': []",
      ].join("\n"),
      "/virtual/security.yaml": [
        "oauth:",
        "  type: oauth2",
        "  flows:",
        "    clientCredentials:",
        "      tokenUrl: https://example.test/token",
        "      scopes: { read: Read access }",
      ].join("\n"),
    });
    const graph = await loadWorkspaceGraph(fs, "/virtual/entry.yaml");
    const diagnostics = lint(graph, resolveConfig(undefined));

    expect(graph.documents.has("/virtual/security.yaml")).toBe(true);
    expect(diagnostics.filter((d) => d.rule === "security/defined" && d.severity === "error")).toEqual([]);
  });
});
