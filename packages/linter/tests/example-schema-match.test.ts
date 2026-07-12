import { describe, expect, test } from "bun:test";
import { InMemoryFileSystem, loadWorkspaceGraph } from "@oasis/core";
import type { FileSystem } from "@oasis/core";
import { lint } from "../src/engine.ts";
import { resolveConfig } from "../src/config.ts";
import { exampleSchemaMatch } from "../src/rules/examples-schema-match.ts";

const ruleList = [exampleSchemaMatch];

async function lintFiles(files: Record<string, string>, entry = "/virtual/entry.yaml") {
  const fs: FileSystem = new InMemoryFileSystem(files);
  const graph = await loadWorkspaceGraph(fs, entry);
  const config = resolveConfig(undefined, ruleList);
  return lint(graph, config, {}, ruleList);
}

function wrap30(componentsSchema: string, extra = ""): string {
  return `
openapi: 3.0.3
info:
  title: Example Match
  version: "1.0.0"
paths: {}
components:
  schemas:
    Thing:
${indent(componentsSchema, 6)}
${extra}
`;
}

function wrap31(componentsSchema: string, extra = ""): string {
  return `
openapi: 3.1.0
info:
  title: Example Match
  version: "1.0.0"
paths: {}
components:
  schemas:
    Thing:
${indent(componentsSchema, 6)}
${extra}
`;
}

function indent(text: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => pad + l)
    .join("\n");
}

describe("examples/schema-match: type (flagship 3.0/3.1 branch)", () => {
  test("3.0: nullable example null passes", async () => {
    const doc = wrap30(`type: string\nnullable: true\nexample: null`);
    const diagnostics = await lintFiles({ "/virtual/entry.yaml": doc });
    expect(diagnostics).toEqual([]);
  });

  test("3.0: null example without nullable fails", async () => {
    const doc = wrap30(`type: string\nexample: null`);
    const diagnostics = await lintFiles({ "/virtual/entry.yaml": doc });
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.message).toContain('expected type "string"');
    expect(diagnostics[0]?.message).toContain("got null");
  });

  test("3.0: mismatched type is flagged", async () => {
    const doc = wrap30(`type: string\nexample: 42`);
    const diagnostics = await lintFiles({ "/virtual/entry.yaml": doc });
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.message).toContain('expected type "string"');
    expect(diagnostics[0]?.message).toContain("got integer");
  });

  test("3.1: type array including null passes for a null example", async () => {
    const doc = wrap31(`type: [string, "null"]\nexample: null`);
    const diagnostics = await lintFiles({ "/virtual/entry.yaml": doc });
    expect(diagnostics).toEqual([]);
  });

  test('3.1: null example fails when "null" is not in the type array', async () => {
    const doc = wrap31(`type: string\nexample: null`);
    const diagnostics = await lintFiles({ "/virtual/entry.yaml": doc });
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.message).toContain("got null");
  });

  test("3.1: matching a member of the type array passes", async () => {
    const doc = wrap31(`type: [string, integer]\nexample: 5`);
    const diagnostics = await lintFiles({ "/virtual/entry.yaml": doc });
    expect(diagnostics).toEqual([]);
  });

  test("integer vs number: type integer rejects 1.5", async () => {
    const doc = wrap30(`type: integer\nexample: 1.5`);
    const diagnostics = await lintFiles({ "/virtual/entry.yaml": doc });
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.message).toContain("got number");
  });

  test("integer vs number: type integer accepts a whole number", async () => {
    const doc = wrap30(`type: integer\nexample: 5`);
    const diagnostics = await lintFiles({ "/virtual/entry.yaml": doc });
    expect(diagnostics).toEqual([]);
  });

  test("integer vs number: type number accepts an integer value", async () => {
    const doc = wrap30(`type: number\nexample: 5`);
    const diagnostics = await lintFiles({ "/virtual/entry.yaml": doc });
    expect(diagnostics).toEqual([]);
  });

  test("unrecognized type keyword produces no crash and is simply not matched", async () => {
    const doc = wrap30(`type: object\nexample: "not an object"`);
    const diagnostics = await lintFiles({ "/virtual/entry.yaml": doc });
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.message).toContain("got string");
  });
});

describe("examples/schema-match: enum / const", () => {
  test("enum: matching value passes", async () => {
    const doc = wrap30(`type: string\nenum: [a, b, c]\nexample: b`);
    const diagnostics = await lintFiles({ "/virtual/entry.yaml": doc });
    expect(diagnostics).toEqual([]);
  });

  test("enum: non-matching value fails", async () => {
    const doc = wrap30(`type: string\nenum: [a, b, c]\nexample: z`);
    const diagnostics = await lintFiles({ "/virtual/entry.yaml": doc });
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.message).toContain("enum");
  });

  test("const (3.1): matching value passes", async () => {
    const doc = wrap31(`const: fixed\nexample: fixed`);
    const diagnostics = await lintFiles({ "/virtual/entry.yaml": doc });
    expect(diagnostics).toEqual([]);
  });

  test("const (3.1): non-matching value fails", async () => {
    const doc = wrap31(`const: fixed\nexample: other`);
    const diagnostics = await lintFiles({ "/virtual/entry.yaml": doc });
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.message).toContain("const");
  });
});

describe("examples/schema-match: object (required/properties/additionalProperties)", () => {
  const schema = `
type: object
required: [name]
properties:
  name:
    type: string
  age:
    type: integer
additionalProperties: false
`;

  test("valid object example passes", async () => {
    const withExample = wrap30(`${schema}\nexample: {name: Alice, age: 30}`);
    const diagnostics = await lintFiles({ "/virtual/entry.yaml": withExample });
    expect(diagnostics).toEqual([]);
  });

  test("missing required property fails", async () => {
    const withExample = wrap30(`${schema}\nexample: {age: 30}`);
    const diagnostics = await lintFiles({ "/virtual/entry.yaml": withExample });
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.message).toContain('missing required property "name"');
  });

  test("additionalProperties: false flags an unexpected property", async () => {
    const withExample = wrap30(`${schema}\nexample: {name: Alice, extra: true}`);
    const diagnostics = await lintFiles({ "/virtual/entry.yaml": withExample });
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.message).toContain('unexpected property "extra"');
  });

  test("wrong property type is flagged with a path", async () => {
    const withExample = wrap30(`${schema}\nexample: {name: Alice, age: "thirty"}`);
    const diagnostics = await lintFiles({ "/virtual/entry.yaml": withExample });
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.message).toContain("/age");
    expect(diagnostics[0]?.message).toContain("got string");
  });
});

describe("examples/schema-match: array (items/prefixItems/minItems/maxItems)", () => {
  test("items: every element must match", async () => {
    const doc = wrap30(`type: array\nitems:\n  type: integer\nexample: [1, 2, "3"]`);
    const diagnostics = await lintFiles({ "/virtual/entry.yaml": doc });
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.message).toContain("/2");
  });

  test("items: all matching elements pass", async () => {
    const doc = wrap30(`type: array\nitems:\n  type: integer\nexample: [1, 2, 3]`);
    const diagnostics = await lintFiles({ "/virtual/entry.yaml": doc });
    expect(diagnostics).toEqual([]);
  });

  test("minItems / maxItems are enforced", async () => {
    const doc = wrap30(`type: array\nminItems: 2\nmaxItems: 3\nexample: [1]`);
    const diagnostics = await lintFiles({ "/virtual/entry.yaml": doc });
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.message).toContain("minItems");
  });

  test("prefixItems (3.1): positional validation, remaining items use items", async () => {
    const doc = wrap31(`type: array\nprefixItems:\n  - type: string\n  - type: integer\nitems:\n  type: boolean\nexample: ["a", 1, true, false]`);
    const diagnostics = await lintFiles({ "/virtual/entry.yaml": doc });
    expect(diagnostics).toEqual([]);
  });

  test("prefixItems (3.1): a positional mismatch is flagged", async () => {
    const doc = wrap31(`type: array\nprefixItems:\n  - type: string\n  - type: integer\nexample: [1, "a"]`);
    const diagnostics = await lintFiles({ "/virtual/entry.yaml": doc });
    expect(diagnostics.length).toBe(2);
  });
});

describe("examples/schema-match: numeric and string constraints", () => {
  test("3.0: exclusiveMinimum/exclusiveMaximum are booleans modifying minimum/maximum", async () => {
    const doc = wrap30(`type: number\nminimum: 0\nexclusiveMinimum: true\nexample: 0`);
    const diagnostics = await lintFiles({ "/virtual/entry.yaml": doc });
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.message).toContain("exclusive");
  });

  test("3.0: minimum without exclusive flag is inclusive", async () => {
    const doc = wrap30(`type: number\nminimum: 0\nexample: 0`);
    const diagnostics = await lintFiles({ "/virtual/entry.yaml": doc });
    expect(diagnostics).toEqual([]);
  });

  test("3.1: exclusiveMinimum/exclusiveMaximum are numeric bounds", async () => {
    const doc = wrap31(`type: number\nexclusiveMinimum: 0\nexample: 0`);
    const diagnostics = await lintFiles({ "/virtual/entry.yaml": doc });
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.message).toContain("exclusiveMinimum");
  });

  test("3.1: value above exclusiveMinimum passes", async () => {
    const doc = wrap31(`type: number\nexclusiveMinimum: 0\nexample: 0.1`);
    const diagnostics = await lintFiles({ "/virtual/entry.yaml": doc });
    expect(diagnostics).toEqual([]);
  });

  test("maximum is enforced", async () => {
    const doc = wrap30(`type: number\nmaximum: 10\nexample: 11`);
    const diagnostics = await lintFiles({ "/virtual/entry.yaml": doc });
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.message).toContain("maximum");
  });

  test("minLength / maxLength are enforced", async () => {
    const doc = wrap30(`type: string\nminLength: 3\nmaxLength: 5\nexample: "ab"`);
    const diagnostics = await lintFiles({ "/virtual/entry.yaml": doc });
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.message).toContain("minLength");
  });

  test("pattern is enforced", async () => {
    const doc = wrap30(`type: string\npattern: "^[a-z]+$"\nexample: "ABC"`);
    const diagnostics = await lintFiles({ "/virtual/entry.yaml": doc });
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.message).toContain("pattern");
  });

  test("matching pattern passes", async () => {
    const doc = wrap30(`type: string\npattern: "^[a-z]+$"\nexample: "abc"`);
    const diagnostics = await lintFiles({ "/virtual/entry.yaml": doc });
    expect(diagnostics).toEqual([]);
  });
});

describe("examples/schema-match: allOf / oneOf / anyOf", () => {
  test("allOf: every branch must pass", async () => {
    const doc = wrap30(`allOf:\n  - type: object\n    required: [name]\n  - properties:\n      age:\n        type: integer\nexample: {name: Alice, age: "old"}`);
    const diagnostics = await lintFiles({ "/virtual/entry.yaml": doc });
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.message).toContain("/age");
  });

  test("allOf: all branches passing means no diagnostic", async () => {
    const doc = wrap30(`allOf:\n  - type: object\n    required: [name]\n  - properties:\n      age:\n        type: integer\nexample: {name: Alice, age: 30}`);
    const diagnostics = await lintFiles({ "/virtual/entry.yaml": doc });
    expect(diagnostics).toEqual([]);
  });

  test("oneOf: passes if at least one branch matches (exclusivity not enforced)", async () => {
    const doc = wrap30(`oneOf:\n  - type: string\n  - type: integer\nexample: 5`);
    const diagnostics = await lintFiles({ "/virtual/entry.yaml": doc });
    expect(diagnostics).toEqual([]);
  });

  test("oneOf: fails if no branch matches", async () => {
    const doc = wrap30(`oneOf:\n  - type: string\n  - type: integer\nexample: true`);
    const diagnostics = await lintFiles({ "/virtual/entry.yaml": doc });
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.message).toContain("oneOf");
  });

  test("anyOf: passes if at least one branch matches", async () => {
    const doc = wrap30(`anyOf:\n  - type: string\n  - type: boolean\nexample: true`);
    const diagnostics = await lintFiles({ "/virtual/entry.yaml": doc });
    expect(diagnostics).toEqual([]);
  });
});

describe("examples/schema-match: deliberate skip cases (report nothing)", () => {
  test('schema using "not" is skipped entirely', async () => {
    const doc = wrap30(`not:\n  type: string\nexample: "still a string"`);
    const diagnostics = await lintFiles({ "/virtual/entry.yaml": doc });
    expect(diagnostics).toEqual([]);
  });

  test("unresolved $ref inside the schema is skipped", async () => {
    const doc = wrap30(`$ref: "#/components/schemas/DoesNotExist"\nexample: "anything"`);
    const diagnostics = await lintFiles({ "/virtual/entry.yaml": doc });
    expect(diagnostics).toEqual([]);
  });

  test("externalValue examples are skipped (no local value to validate)", async () => {
    const doc = `
openapi: 3.0.3
info:
  title: Example Match
  version: "1.0.0"
paths:
  /things:
    get:
      operationId: getThings
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                type: string
              examples:
                sample:
                  externalValue: "https://example.com/sample.json"
`;
    const diagnostics = await lintFiles({ "/virtual/entry.yaml": doc });
    expect(diagnostics).toEqual([]);
  });

  test("discriminator-bearing schemas are skipped", async () => {
    const doc = wrap30(`oneOf:\n  - type: object\ndiscriminator:\n  propertyName: kind\nexample: {kind: "dog"}`);
    const diagnostics = await lintFiles({ "/virtual/entry.yaml": doc });
    expect(diagnostics).toEqual([]);
  });
});

describe("examples/schema-match: media type / parameter placements", () => {
  test("response content media type example is validated against its schema", async () => {
    const doc = `
openapi: 3.0.3
info:
  title: Example Match
  version: "1.0.0"
paths:
  /things:
    get:
      operationId: getThings
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                type: object
                required: [id]
                properties:
                  id:
                    type: integer
              example:
                id: "not an integer"
`;
    const diagnostics = await lintFiles({ "/virtual/entry.yaml": doc });
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.message).toContain("response \"200\"");
  });

  test("request body examples map (examples.<name>.value) is validated", async () => {
    const doc = `
openapi: 3.0.3
info:
  title: Example Match
  version: "1.0.0"
paths:
  /things:
    post:
      operationId: createThing
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                id:
                  type: integer
            examples:
              good:
                value:
                  id: 1
              bad:
                value:
                  id: "nope"
      responses:
        '201':
          description: Created
`;
    const diagnostics = await lintFiles({ "/virtual/entry.yaml": doc });
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.message).toContain('examples."bad"');
  });

  test("parameter example is validated against the parameter's schema", async () => {
    const doc = `
openapi: 3.0.3
info:
  title: Example Match
  version: "1.0.0"
paths:
  /things/{id}:
    get:
      operationId: getThing
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
          example: "not-an-integer"
      responses:
        '200':
          description: OK
`;
    const diagnostics = await lintFiles({ "/virtual/entry.yaml": doc });
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.message).toContain('parameter "id"');
  });

  test("parameter using content (not schema directly) validates its media type example", async () => {
    const doc = `
openapi: 3.0.3
info:
  title: Example Match
  version: "1.0.0"
paths:
  /things:
    get:
      operationId: getThings
      parameters:
        - name: filter
          in: query
          content:
            application/json:
              schema:
                type: object
                required: [field]
              example: {}
      responses:
        '200':
          description: OK
`;
    const diagnostics = await lintFiles({ "/virtual/entry.yaml": doc });
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.message).toContain('missing required property "field"');
  });

  test("no schema on the media type / parameter means nothing to check", async () => {
    const doc = `
openapi: 3.0.3
info:
  title: Example Match
  version: "1.0.0"
paths:
  /things:
    get:
      operationId: getThings
      responses:
        '200':
          description: OK
`;
    const diagnostics = await lintFiles({ "/virtual/entry.yaml": doc });
    expect(diagnostics).toEqual([]);
  });
});

describe("examples/schema-match: $ref across files", () => {
  test("a schema $ref'd from another file is resolved and the example is attributed to that file", async () => {
    const entry = `
openapi: 3.0.3
info:
  title: Example Match
  version: "1.0.0"
paths:
  /things:
    get:
      operationId: getThings
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: './schemas.yaml#/components/schemas/Thing'
              example:
                id: "wrong type"
`;
    const schemas = `
components:
  schemas:
    Thing:
      type: object
      required: [id]
      properties:
        id:
          type: integer
`;
    const diagnostics = await lintFiles({
      "/virtual/entry.yaml": entry,
      "/virtual/schemas.yaml": schemas,
    });
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.range.filePath).toBe("/virtual/entry.yaml");
  });

  test("a schema with its own example, defined in a $ref'd file, is attributed to that file", async () => {
    const entry = `
openapi: 3.0.3
info:
  title: Example Match
  version: "1.0.0"
paths: {}
components:
  schemas:
    Wrapper:
      allOf:
        - $ref: './schemas.yaml#/components/schemas/Thing'
`;
    const schemas = `
components:
  schemas:
    Thing:
      type: object
      required: [id]
      properties:
        id:
          type: integer
      example:
        id: "wrong type"
`;
    const diagnostics = await lintFiles({
      "/virtual/entry.yaml": entry,
      "/virtual/schemas.yaml": schemas,
    });
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.range.filePath).toBe("/virtual/schemas.yaml");
  });
});

describe("examples/schema-match: schema-level example (directly on a Schema Object)", () => {
  test("a components/schemas entry's own example is validated against itself", async () => {
    const doc = wrap30(`type: object\nrequired: [id]\nproperties:\n  id:\n    type: integer\nexample:\n  id: "not an integer"`);
    const diagnostics = await lintFiles({ "/virtual/entry.yaml": doc });
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.message).toContain("Schema example does not match schema");
  });

  test("a nested property schema's own example is also validated", async () => {
    const doc = wrap30(`
type: object
properties:
  child:
    type: string
    example: 123
`);
    const diagnostics = await lintFiles({ "/virtual/entry.yaml": doc });
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.message).toContain("got integer");
  });
});
