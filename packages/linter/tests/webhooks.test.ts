import { describe, expect, test } from "bun:test";
import { InMemoryFileSystem, loadWorkspaceGraph } from "@oasis/core";
import { lint } from "../src/engine.ts";
import { resolveConfig } from "../src/config.ts";
import type { LintConfigFile } from "../src/config.ts";

async function lintFiles(files: Record<string, string>, config?: LintConfigFile, entry = "/virtual/entry.yaml") {
  const fs = new InMemoryFileSystem(files);
  const graph = await loadWorkspaceGraph(fs, entry);
  return lint(graph, resolveConfig(config));
}

/** A 3.1 document whose webhooks carry one violation per operation-level rule. */
const WEBHOOKS_31 = `
openapi: 3.1.0
info:
  title: Webhooks
  version: "1.0.0"
tags:
  - name: known
paths:
  /pets:
    get:
      operationId: dupId
      tags: [known]
      description: x
      responses:
        '200':
          description: OK
webhooks:
  newPet:
    post:
      operationId: dupId
      tags: [unknownTag]
      description: x
      security:
        - missingScheme: []
      responses:
        default:
          description: only default
  "{weird}":
    get:
      operationId: weirdHook
      description: x
      responses:
        '200':
          description: OK
`;

describe("3.1 webhooks: operation rules apply", () => {
  test("operation-operationId is unique across paths and webhooks", async () => {
    const diagnostics = await lintFiles({ "/virtual/entry.yaml": WEBHOOKS_31 });
    const dupes = diagnostics.filter((d) => d.rule === "operation-operationId");
    expect(dupes.length).toBe(1);
    expect(dupes[0]?.message).toContain('Duplicate operationId "dupId"');
  });

  test("operation-tags fires on a webhook operation with no tags", async () => {
    const diagnostics = await lintFiles({ "/virtual/entry.yaml": WEBHOOKS_31 });
    const d = diagnostics.filter((d) => d.rule === "operation-tags");
    expect(d.length).toBe(1);
    expect(d[0]?.message).toContain("{weird}");
  });

  test("operation-success-response fires on a webhook operation with only a default response", async () => {
    const diagnostics = await lintFiles({ "/virtual/entry.yaml": WEBHOOKS_31 });
    const d = diagnostics.filter((d) => d.rule === "operation-success-response");
    expect(d.length).toBe(1);
    expect(d[0]?.message).toContain("POST newPet");
  });

  test("operation-description fires on a webhook operation without description/summary", async () => {
    const doc = `
openapi: 3.1.0
info:
  title: Webhooks
  version: "1.0.0"
paths: {}
webhooks:
  newPet:
    post:
      operationId: onNewPet
      tags: [a]
      responses:
        '200':
          description: OK
`;
    const diagnostics = await lintFiles({ "/virtual/entry.yaml": doc });
    const d = diagnostics.filter((d) => d.rule === "operation-description");
    expect(d.length).toBe(1);
    expect(d[0]?.message).toContain("POST newPet");
  });

  test("security-defined fires on a webhook operation's security requirement", async () => {
    const diagnostics = await lintFiles({ "/virtual/entry.yaml": WEBHOOKS_31 });
    const d = diagnostics.filter((d) => d.rule === "security-defined");
    expect(d.length).toBe(1);
    expect(d[0]?.message).toContain("missingScheme");
  });

  test("tags-defined fires on a webhook operation's undeclared tag", async () => {
    const diagnostics = await lintFiles({ "/virtual/entry.yaml": WEBHOOKS_31 }, { lint: { rules: { "tags-defined": "warn" } } });
    const d = diagnostics.filter((d) => d.rule === "tags-defined");
    expect(d.length).toBe(1);
    expect(d[0]?.message).toContain("unknownTag");
  });
});

describe("3.1 webhooks: path-shaped rules do NOT apply", () => {
  test("path-params-defined ignores webhook keys (arbitrary names, not URL templates)", async () => {
    const diagnostics = await lintFiles({ "/virtual/entry.yaml": WEBHOOKS_31 });
    // "{weird}" looks like a path template parameter but is just a webhook name.
    expect(diagnostics.some((d) => d.rule === "path-params-defined")).toBe(false);
  });

  test("no-duplicate-paths ignores webhooks entirely", async () => {
    const doc = `
openapi: 3.1.0
info:
  title: Webhooks
  version: "1.0.0"
paths:
  /users/{id}:
    get:
      operationId: getUser
      tags: [a]
      description: x
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      responses:
        '200':
          description: OK
webhooks:
  /users/{userId}:
    post:
      operationId: onUser
      tags: [a]
      description: x
      responses:
        '200':
          description: OK
`;
    const diagnostics = await lintFiles({ "/virtual/entry.yaml": doc });
    expect(diagnostics.some((d) => d.rule === "no-duplicate-paths")).toBe(false);
    expect(diagnostics.some((d) => d.rule === "path-params-defined")).toBe(false);
  });
});

describe("3.0 documents: webhooks is not walked", () => {
  test("a webhooks map on a 3.0 document produces no operation diagnostics", async () => {
    const doc = `
openapi: 3.0.3
info:
  title: Not Webhooks
  version: "1.0.0"
paths: {}
webhooks:
  newPet:
    post:
      responses:
        default:
          description: only default
`;
    const diagnostics = await lintFiles({ "/virtual/entry.yaml": doc });
    for (const rule of ["operation-operationId", "operation-tags", "operation-description", "operation-success-response"]) {
      expect(diagnostics.some((d) => d.rule === rule)).toBe(false);
    }
  });
});

describe("3.1 webhooks: refs and schemas", () => {
  test("no-unused-components counts a component referenced only from a webhook", async () => {
    const doc = `
openapi: 3.1.0
info:
  title: Webhooks
  version: "1.0.0"
paths: {}
webhooks:
  newPet:
    post:
      operationId: onNewPet
      tags: [a]
      description: x
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/Pet'
      responses:
        '200':
          description: OK
components:
  schemas:
    Pet:
      type: object
`;
    const diagnostics = await lintFiles({ "/virtual/entry.yaml": doc });
    expect(diagnostics.some((d) => d.rule === "no-unused-components")).toBe(false);
  });

  test("example-schema-match validates a webhook request body example", async () => {
    const doc = `
openapi: 3.1.0
info:
  title: Webhooks
  version: "1.0.0"
paths: {}
webhooks:
  newPet:
    post:
      operationId: onNewPet
      tags: [a]
      description: x
      requestBody:
        content:
          application/json:
            schema:
              type: integer
            example: "not an integer"
      responses:
        '200':
          description: OK
`;
    const diagnostics = await lintFiles({ "/virtual/entry.yaml": doc });
    const d = diagnostics.filter((d) => d.rule === "example-schema-match");
    expect(d.length).toBe(1);
    expect(d[0]?.message).toContain("got string");
  });

  test("structure/schema-nullable fires inside a webhook's inline schema", async () => {
    const doc = `
openapi: 3.1.0
info:
  title: Webhooks
  version: "1.0.0"
paths: {}
webhooks:
  newPet:
    post:
      operationId: onNewPet
      tags: [a]
      description: x
      requestBody:
        content:
          application/json:
            schema:
              type: object
              nullable: true
      responses:
        '200':
          description: OK
`;
    const diagnostics = await lintFiles({ "/virtual/entry.yaml": doc });
    const d = diagnostics.filter((d) => d.rule === "structure/schema-nullable");
    expect(d.length).toBe(1);
    expect(d[0]?.message).toContain('"nullable" is not part of OpenAPI 3.1');
  });
});
