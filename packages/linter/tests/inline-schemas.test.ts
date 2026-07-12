import { describe, expect, test } from "bun:test";
import { InMemoryFileSystem, loadWorkspaceGraph } from "@oasis/core";
import { lint } from "../src/engine.ts";
import { resolveConfig } from "../src/config.ts";
import { namingConvention } from "../src/rules/naming-convention.ts";

async function lintFiles(files: Record<string, string>, entry = "/virtual/entry.yaml") {
  const fs = new InMemoryFileSystem(files);
  const graph = await loadWorkspaceGraph(fs, entry);
  return lint(graph, resolveConfig(undefined));
}

describe("structure/schema-nullable on inline schemas", () => {
  test("fires on request body, parameter, and components/responses header schemas", async () => {
    const doc = `
openapi: 3.1.0
info:
  title: Inline
  version: "1.0.0"
paths:
  /pets:
    post:
      operationId: createPet
      tags: [a]
      description: x
      parameters:
        - name: verbose
          in: query
          schema:
            type: boolean
            nullable: true
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                name:
                  type: string
                  nullable: true
      responses:
        '200':
          description: OK
components:
  responses:
    WithHeader:
      description: OK
      headers:
        X-Rate-Limit:
          schema:
            type: integer
            nullable: true
`;
    const diagnostics = await lintFiles({ "/virtual/entry.yaml": doc });
    const d = diagnostics.filter((x) => x.rule === "structure/schema-nullable");
    expect(d.length).toBe(3);
  });

  test("a schema shared via $ref from two operations is checked once", async () => {
    const doc = `
openapi: 3.1.0
info:
  title: Inline
  version: "1.0.0"
paths:
  /a:
    get:
      operationId: getA
      tags: [a]
      description: x
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Shared'
  /b:
    get:
      operationId: getB
      tags: [a]
      description: x
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Shared'
components:
  schemas:
    Shared:
      type: object
      nullable: true
`;
    const diagnostics = await lintFiles({ "/virtual/entry.yaml": doc });
    const d = diagnostics.filter((x) => x.rule === "structure/schema-nullable");
    expect(d.length).toBe(1);
  });
});

describe("naming-convention propertyName on inline schemas", () => {
  test("fires on properties of an inline request body schema", async () => {
    const doc = `
openapi: 3.0.3
info:
  title: Inline
  version: "1.0.0"
paths:
  /pets:
    post:
      operationId: createPet
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                bad_name:
                  type: string
      responses:
        '201':
          description: Created
`;
    const fs = new InMemoryFileSystem({ "/virtual/entry.yaml": doc });
    const graph = await loadWorkspaceGraph(fs, "/virtual/entry.yaml");
    const ruleList = [namingConvention];
    const config = resolveConfig({ lint: { rules: { "naming-convention": ["warn", { propertyName: "camelCase" }] } } }, ruleList);
    const diagnostics = lint(graph, config, {}, ruleList);
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.message).toContain('Property "bad_name" is not camelCase');
  });
});

describe("example-schema-match on inline schemas", () => {
  test("fires on a schema-level example inside a components-level requestBody (previously missed)", async () => {
    const doc = `
openapi: 3.0.3
info:
  title: Inline
  version: "1.0.0"
paths: {}
components:
  requestBodies:
    CreatePet:
      content:
        application/json:
          schema:
            type: integer
            example: "not an integer"
`;
    const diagnostics = await lintFiles({ "/virtual/entry.yaml": doc });
    const d = diagnostics.filter((x) => x.rule === "example-schema-match");
    expect(d.length).toBe(1);
    expect(d[0]?.message).toContain("got string");
  });

  test("an inline media-type schema's self-example is reported exactly once (no double walk)", async () => {
    const doc = `
openapi: 3.0.3
info:
  title: Inline
  version: "1.0.0"
paths:
  /pets:
    get:
      operationId: getPets
      tags: [a]
      description: x
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                type: integer
                example: "not an integer"
`;
    const diagnostics = await lintFiles({ "/virtual/entry.yaml": doc });
    const d = diagnostics.filter((x) => x.rule === "example-schema-match");
    expect(d.length).toBe(1);
  });

  test("a $ref-shared schema's own bad example is reported exactly once across two referencing operations", async () => {
    const doc = `
openapi: 3.0.3
info:
  title: Inline
  version: "1.0.0"
paths:
  /a:
    get:
      operationId: getA
      tags: [a]
      description: x
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Shared'
  /b:
    get:
      operationId: getB
      tags: [a]
      description: x
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Shared'
components:
  schemas:
    Shared:
      type: integer
      example: "not an integer"
`;
    const diagnostics = await lintFiles({ "/virtual/entry.yaml": doc });
    const d = diagnostics.filter((x) => x.rule === "example-schema-match");
    expect(d.length).toBe(1);
  });
});
