import { describe, expect, test } from "bun:test";
import { InMemoryFileSystem, loadWorkspaceGraph, NodeFileSystem } from "@oasis/core";
import { lint } from "../src/engine.ts";
import { resolveConfig } from "../src/config.ts";

const fixturesRoot = `${import.meta.dir}/fixtures`;

async function lintFixture(relativePath: string) {
  const fs = new NodeFileSystem();
  const entry = `${fixturesRoot}/${relativePath}`;
  const graph = await loadWorkspaceGraph(fs, entry);
  const config = resolveConfig(undefined);
  return lint(graph, config);
}

describe("structure/required-fields", () => {
  test("flags a missing paths field", async () => {
    const diagnostics = await lintFixture("structure/missing-paths.yaml");
    const d = diagnostics.find((d) => d.rule === "structure/required-fields");
    expect(d).toBeDefined();
    expect(d?.message).toContain("paths");
    expect(d?.range.start.line).toBe(0);
  });

  test("valid fixture passes", async () => {
    const diagnostics = await lintFixture("valid/openapi.yaml");
    expect(diagnostics.some((d) => d.rule === "structure/required-fields")).toBe(false);
  });
});

describe("structure/openapi-version", () => {
  test("flags a non 3.0/3.1 version string", async () => {
    const diagnostics = await lintFixture("structure/bad-version.yaml");
    const d = diagnostics.find((d) => d.rule === "structure/openapi-version");
    expect(d).toBeDefined();
    expect(d?.range.start.line).toBe(0);
  });

  test("valid fixture passes", async () => {
    const diagnostics = await lintFixture("valid/openapi.yaml");
    expect(diagnostics.some((d) => d.rule === "structure/openapi-version")).toBe(false);
  });
});

describe("structure/field-types", () => {
  test("flags a top-level field with the wrong type", async () => {
    const diagnostics = await lintFixture("structure/bad-field-types.yaml");
    const d = diagnostics.find((d) => d.rule === "structure/field-types");
    expect(d).toBeDefined();
    expect(d?.message).toContain("tags");
    expect(d?.range.start.line).toBe(4);
  });

  test("valid fixture passes", async () => {
    const diagnostics = await lintFixture("valid/openapi.yaml");
    expect(diagnostics.some((d) => d.rule === "structure/field-types")).toBe(false);
  });

  describe("responses status code keys are case-sensitive (lowercase default, uppercase XX ranges)", () => {
    const docWithStatus = (status: string) => `
openapi: 3.0.3
info:
  title: T
  version: "1.0.0"
paths:
  /ping:
    get:
      operationId: ping
      responses:
        '${status}':
          description: OK
`;

    test('"2xx" (lowercase range) is flagged, not silently accepted', async () => {
      const fs = new InMemoryFileSystem({ "/virtual/entry.yaml": docWithStatus("2xx") });
      const graph = await loadWorkspaceGraph(fs, "/virtual/entry.yaml");
      const diagnostics = lint(graph, resolveConfig(undefined));
      const d = diagnostics.find((d) => d.rule === "structure/field-types" && d.message.includes("not a valid HTTP status code"));
      expect(d).toBeDefined();
    });

    test('"DEFAULT" (uppercase) is flagged, not silently accepted', async () => {
      const fs = new InMemoryFileSystem({ "/virtual/entry.yaml": docWithStatus("DEFAULT") });
      const graph = await loadWorkspaceGraph(fs, "/virtual/entry.yaml");
      const diagnostics = lint(graph, resolveConfig(undefined));
      const d = diagnostics.find((d) => d.rule === "structure/field-types" && d.message.includes("not a valid HTTP status code"));
      expect(d).toBeDefined();
    });

    test('"2XX" (correct uppercase range) is accepted', async () => {
      const fs = new InMemoryFileSystem({ "/virtual/entry.yaml": docWithStatus("2XX") });
      const graph = await loadWorkspaceGraph(fs, "/virtual/entry.yaml");
      const diagnostics = lint(graph, resolveConfig(undefined));
      expect(diagnostics.some((d) => d.rule === "structure/field-types" && d.message.includes("not a valid HTTP status code"))).toBe(false);
    });

    test('"default" (correct lowercase) is accepted', async () => {
      const fs = new InMemoryFileSystem({ "/virtual/entry.yaml": docWithStatus("default") });
      const graph = await loadWorkspaceGraph(fs, "/virtual/entry.yaml");
      const diagnostics = lint(graph, resolveConfig(undefined));
      expect(diagnostics.some((d) => d.rule === "structure/field-types" && d.message.includes("not a valid HTTP status code"))).toBe(false);
    });
  });

  describe("empty Responses Object (#44)", () => {
    test("flags an operation's empty responses: {}", async () => {
      const diagnostics = await lintFixture("structure/empty-responses.yaml");
      const d = diagnostics.find(
        (d) =>
          d.rule === "structure/field-types" &&
          d.message.includes("paths./pets.get.responses") &&
          d.message.includes("at least one response code"),
      );
      expect(d).toBeDefined();
    });

    test("does not flag a responses object with a valid entry", async () => {
      const diagnostics = await lintFixture("structure/empty-responses.yaml");
      const d = diagnostics.find(
        (d) =>
          d.rule === "structure/field-types" &&
          d.message.includes("paths./pets.post.responses") &&
          d.message.includes("at least one response code"),
      );
      expect(d).toBeUndefined();
    });

    test("accepts an extension (x-*) field as a valid responses entry", async () => {
      const fs = new InMemoryFileSystem({
        "/virtual/entry.yaml": `
openapi: 3.1.0
info:
  title: T
  version: "1.0.0"
paths:
  /ping:
    get:
      operationId: ping
      responses:
        x-custom: {}
`,
      });
      const graph = await loadWorkspaceGraph(fs, "/virtual/entry.yaml");
      const diagnostics = lint(graph, resolveConfig(undefined));
      expect(diagnostics.some((d) => d.rule === "structure/field-types" && d.message.includes("at least one response code"))).toBe(false);
    });

    test("flags an empty responses in a callback operation", async () => {
      const diagnostics = await lintFixture("structure/empty-responses.yaml");
      const d = diagnostics.find(
        (d) => d.rule === "structure/callbacks" && d.message.includes("at least one response code"),
      );
      expect(d).toBeDefined();
    });

    test("attributes the diagnostic to the file that owns a $ref'd Path Item's operation", async () => {
      const fs = new NodeFileSystem();
      const entry = `${fixturesRoot}/structure-multifile-empty-responses/entry.yaml`;
      const graph = await loadWorkspaceGraph(fs, entry);
      const diagnostics = lint(graph, resolveConfig(undefined));
      const d = diagnostics.find((d) => d.rule === "structure/field-types" && d.message.includes("at least one response code"));
      expect(d).toBeDefined();
      expect(d?.range.filePath).toBe(`${fixturesRoot}/structure-multifile-empty-responses/paths-pets.yaml`);
    });

    test("valid fixture passes", async () => {
      const diagnostics = await lintFixture("valid/openapi.yaml");
      expect(diagnostics.some((d) => d.rule === "structure/field-types" && d.message.includes("at least one response code"))).toBe(false);
    });
  });
});

describe("structure/field-types — Parameter Objects (#46)", () => {
  test("flags a components/parameters entry missing name and in", async () => {
    const diagnostics = await lintFixture("structure/parameter-objects-bad.yaml");
    const d = diagnostics.find(
      (d) =>
        d.rule === "structure/field-types" &&
        d.message.includes("/components/parameters/Broken") &&
        d.message.includes('missing required field "name"'),
    );
    expect(d).toBeDefined();
    const d2 = diagnostics.find(
      (d) =>
        d.rule === "structure/field-types" &&
        d.message.includes("/components/parameters/Broken") &&
        d.message.includes('"in" set to one of'),
    );
    expect(d2).toBeDefined();
  });

  test("flags an in: path parameter without required: true", async () => {
    const diagnostics = await lintFixture("structure/parameter-objects-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/field-types" && d.message.includes('"in: path"') && d.message.includes('"required: true"'),
    );
    expect(d).toBeDefined();
  });

  test("flags schema/content used together (mutually exclusive)", async () => {
    const diagnostics = await lintFixture("structure/parameter-objects-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/field-types" && d.message.includes("must not have both") && d.message.includes('"schema"') && d.message.includes('"content"'),
    );
    expect(d).toBeDefined();
  });

  test("flags a non-boolean explode", async () => {
    const diagnostics = await lintFixture("structure/parameter-objects-bad.yaml");
    const d = diagnostics.find((d) => d.rule === "structure/field-types" && d.message.includes('"explode" must be a boolean'));
    expect(d).toBeDefined();
  });

  test("flags allowReserved on a non-query (header) parameter", async () => {
    const diagnostics = await lintFixture("structure/parameter-objects-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/field-types" && d.message.includes('"allowReserved"') && d.message.includes("only applies to"),
    );
    expect(d).toBeDefined();
  });

  test("flags an invalid style for the parameter's location (path-item-level header parameter)", async () => {
    const diagnostics = await lintFixture("structure/parameter-objects-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/field-types" && d.message.includes('"style: form"') && d.message.includes('"in: header"'),
    );
    expect(d).toBeDefined();
  });

  test("resolves a $ref to a broken components/parameters entry used from an operation", async () => {
    const diagnostics = await lintFixture("structure/parameter-objects-bad.yaml");
    // The $ref'd operation parameter and the direct components/parameters entry are the same
    // resolved location, so this should be reported exactly once (dedup by resolved pointer).
    const matches = diagnostics.filter(
      (d) => d.rule === "structure/field-types" && d.message.includes("/components/parameters/Broken") && d.message.includes('missing required field "name"'),
    );
    expect(matches.length).toBe(1);
  });

  test("valid fixture passes with no Parameter Object diagnostics", async () => {
    const diagnostics = await lintFixture("structure/parameter-objects-valid.yaml");
    expect(diagnostics.filter((d) => d.rule === "structure/field-types")).toEqual([]);
  });

  test("attributes a diagnostic to the file that owns a $ref'd operation parameter", async () => {
    const fs = new NodeFileSystem();
    const entry = `${fixturesRoot}/structure-multifile-parameter-objects/entry.yaml`;
    const graph = await loadWorkspaceGraph(fs, entry);
    const diagnostics = lint(graph, resolveConfig(undefined));
    const d = diagnostics.find(
      (d) => d.rule === "structure/field-types" && d.message.includes('missing required field "name"'),
    );
    expect(d).toBeDefined();
    expect(d?.range.filePath).toBe(`${fixturesRoot}/structure-multifile-parameter-objects/params.yaml`);
  });

  test("resolves a components/parameters entry that is itself a cross-file $ref", async () => {
    const fs = new NodeFileSystem();
    const entry = `${fixturesRoot}/structure-multifile-parameter-component-ref/entry.yaml`;
    const graph = await loadWorkspaceGraph(fs, entry);
    const diagnostics = lint(graph, resolveConfig(undefined));
    const d = diagnostics.find(
      (d) => d.rule === "structure/field-types" && d.message.includes('missing required field "name"'),
    );
    expect(d).toBeDefined();
    expect(d?.range.filePath).toBe(`${fixturesRoot}/structure-multifile-parameter-component-ref/shared.yaml`);
  });
});

describe("structure/http-methods", () => {
  test("flags an invalid key under a path item", async () => {
    const diagnostics = await lintFixture("structure/bad-method.yaml");
    const d = diagnostics.find((d) => d.rule === "structure/http-methods");
    expect(d).toBeDefined();
    expect(d?.message).toContain("fetch");
    expect(d?.range.start.line).toBe(6);
  });

  test("valid fixture passes", async () => {
    const diagnostics = await lintFixture("valid/openapi.yaml");
    expect(diagnostics.some((d) => d.rule === "structure/http-methods")).toBe(false);
  });
});

describe("structure/schema-nullable", () => {
  test("flags a type array in OpenAPI 3.0", async () => {
    const diagnostics = await lintFixture("structure/schema-nullable-30.yaml");
    const d = diagnostics.find((d) => d.rule === "structure/schema-nullable");
    expect(d).toBeDefined();
    expect(d?.range.start.line).toBe(20);
  });

  test("flags nullable in OpenAPI 3.1", async () => {
    const diagnostics = await lintFixture("structure/schema-nullable-31.yaml");
    const d = diagnostics.find((d) => d.rule === "structure/schema-nullable");
    expect(d).toBeDefined();
    expect(d?.range.start.line).toBe(21);
  });

  test("valid fixture passes", async () => {
    const diagnostics = await lintFixture("valid/openapi.yaml");
    expect(diagnostics.some((d) => d.rule === "structure/schema-nullable")).toBe(false);
  });
});

describe("structure/schema-keywords", () => {
  const only31Keywords = [
    "const",
    "prefixItems",
    "contentMediaType",
    "contentEncoding",
    "patternProperties",
    "propertyNames",
    "unevaluatedProperties",
    "unevaluatedItems",
    "dependentRequired",
    "dependentSchemas",
    "if",
    "then",
    "else",
    "$defs",
    "examples",
  ];

  test("flags every 3.1-only keyword when used in an OpenAPI 3.0 document", async () => {
    const diagnostics = await lintFixture("structure/schema-keywords-30-bad.yaml");
    for (const keyword of only31Keywords) {
      const d = diagnostics.find(
        (d) => d.rule === "structure/schema-keywords" && d.message.includes(`"${keyword}"`) && d.message.includes("not supported in OpenAPI 3.0"),
      );
      expect(d, `expected a diagnostic for "${keyword}"`).toBeDefined();
    }
  });

  test("does not flag structure/schema-nullable's territory (nullable, type arrays, type: null)", async () => {
    const diagnostics = await lintFixture("structure/schema-keywords-30-bad.yaml");
    const keywordDiagnostics = diagnostics.filter((d) => d.rule === "structure/schema-keywords");
    expect(keywordDiagnostics.some((d) => d.message.includes('"nullable"'))).toBe(false);
  });

  test("flags numeric exclusiveMinimum on OpenAPI 3.0 (boolean form required)", async () => {
    const diagnostics = await lintFixture("structure/schema-keywords-30-bad.yaml");
    const d = diagnostics.find((d) => d.rule === "structure/schema-keywords" && d.message.includes('"exclusiveMinimum" must be a boolean'));
    expect(d).toBeDefined();
  });

  test("flags non-boolean exclusiveMinimum/exclusiveMaximum node kinds on OpenAPI 3.0 (#41)", async () => {
    const diagnostics = await lintFixture("structure/schema-keywords-30-bad.yaml");
    const minDiagnostics = diagnostics.filter(
      (d) => d.rule === "structure/schema-keywords" && d.message.includes('"exclusiveMinimum" must be a boolean'),
    );
    const maxDiagnostics = diagnostics.filter(
      (d) => d.rule === "structure/schema-keywords" && d.message.includes('"exclusiveMaximum" must be a boolean'),
    );
    // NumericExclusive (number), MapExclusive ({}), and NullExclusive (null) all use exclusiveMinimum.
    expect(minDiagnostics.length).toBeGreaterThanOrEqual(3);
    // SeqExclusive ([]) and StringExclusive ("5") both use exclusiveMaximum.
    expect(maxDiagnostics.length).toBeGreaterThanOrEqual(2);
    for (const d of [...minDiagnostics, ...maxDiagnostics]) {
      expect(typeof d.range.start.line).toBe("number");
    }
  });

  test("flags an unrecognized type name in OpenAPI 3.0", async () => {
    const diagnostics = await lintFixture("structure/schema-keywords-30-bad.yaml");
    const d = diagnostics.find((d) => d.rule === "structure/schema-keywords" && d.message.includes('"type: file"'));
    expect(d).toBeDefined();
  });

  test("flags a non-string type value in OpenAPI 3.0", async () => {
    const diagnostics = await lintFixture("structure/schema-keywords-30-bad.yaml");
    const d = diagnostics.find((d) => d.rule === "structure/schema-keywords" && d.message.includes('"type" must be a string in OpenAPI 3.0'));
    expect(d).toBeDefined();
  });

  test("flags a negative minLength", async () => {
    const diagnostics = await lintFixture("structure/schema-keywords-30-bad.yaml");
    const d = diagnostics.find((d) => d.rule === "structure/schema-keywords" && d.message.includes('"minLength" must be a non-negative integer'));
    expect(d).toBeDefined();
  });

  test("flags a non-integer maxItems", async () => {
    const diagnostics = await lintFixture("structure/schema-keywords-30-bad.yaml");
    const d = diagnostics.find((d) => d.rule === "structure/schema-keywords" && d.message.includes('"maxItems" must be a non-negative integer'));
    expect(d).toBeDefined();
  });

  test("flags multipleOf: 0", async () => {
    const diagnostics = await lintFixture("structure/schema-keywords-30-bad.yaml");
    const d = diagnostics.find((d) => d.rule === "structure/schema-keywords" && d.message.includes('"multipleOf" must be greater than 0'));
    expect(d).toBeDefined();
  });

  test("flags minimum > maximum", async () => {
    const diagnostics = await lintFixture("structure/schema-keywords-30-bad.yaml");
    const d = diagnostics.find((d) => d.rule === "structure/schema-keywords" && d.message.includes('"minimum" (10) is greater than "maximum" (5)'));
    expect(d).toBeDefined();
  });

  test("flags an invalid regex pattern", async () => {
    const diagnostics = await lintFixture("structure/schema-keywords-30-bad.yaml");
    const d = diagnostics.find((d) => d.rule === "structure/schema-keywords" && d.message.includes('"pattern" is not a valid regular expression'));
    expect(d).toBeDefined();
  });

  test("flags an empty required array", async () => {
    const diagnostics = await lintFixture("structure/schema-keywords-30-bad.yaml");
    const d = diagnostics.find((d) => d.rule === "structure/schema-keywords" && d.message.includes('"required" must be a non-empty array'));
    expect(d).toBeDefined();
  });

  test("flags a duplicate required entry", async () => {
    const diagnostics = await lintFixture("structure/schema-keywords-30-bad.yaml");
    const d = diagnostics.find((d) => d.rule === "structure/schema-keywords" && d.message.includes('"required" contains duplicate entry "a"'));
    expect(d).toBeDefined();
  });

  test("flags an empty enum array", async () => {
    const diagnostics = await lintFixture("structure/schema-keywords-30-bad.yaml");
    const d = diagnostics.find((d) => d.rule === "structure/schema-keywords" && d.message.includes('"enum" must be a non-empty array'));
    expect(d).toBeDefined();
  });

  test("flags a tuple-form items array in OpenAPI 3.0", async () => {
    const diagnostics = await lintFixture("structure/schema-keywords-30-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/schema-keywords" && d.message.includes('"items" must be a single schema object in OpenAPI 3.0'),
    );
    expect(d).toBeDefined();
  });

  test("flags a non-object properties value", async () => {
    const diagnostics = await lintFixture("structure/schema-keywords-30-bad.yaml");
    const d = diagnostics.find((d) => d.rule === "structure/schema-keywords" && d.message.includes('"properties" must be an object'));
    expect(d).toBeDefined();
  });

  test("flags an additionalProperties value that is neither boolean nor a schema", async () => {
    const diagnostics = await lintFixture("structure/schema-keywords-30-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/schema-keywords" && d.message.includes('"additionalProperties" must be a boolean or a schema object'),
    );
    expect(d).toBeDefined();
  });

  test("flags required listing a property excluded by additionalProperties: false", async () => {
    const diagnostics = await lintFixture("structure/schema-keywords-30-bad.yaml");
    const d = diagnostics.find(
      (d) =>
        d.rule === "structure/schema-keywords" &&
        d.message.includes('"required" lists "b"') &&
        d.message.includes("can never be satisfied"),
    );
    expect(d).toBeDefined();
  });

  test("flags a non-string format", async () => {
    const diagnostics = await lintFixture("structure/schema-keywords-30-bad.yaml");
    const d = diagnostics.find((d) => d.rule === "structure/schema-keywords" && d.message.includes('"format" must be a string'));
    expect(d).toBeDefined();
  });

  test("flags sibling keys alongside $ref in OpenAPI 3.0", async () => {
    const diagnostics = await lintFixture("structure/schema-keywords-30-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/schema-keywords" && d.message.includes("Sibling keys alongside") && d.message.includes('"description"'),
    );
    expect(d).toBeDefined();
  });

  test("flags boolean exclusiveMinimum on OpenAPI 3.1 (numeric form required)", async () => {
    const diagnostics = await lintFixture("structure/schema-keywords-31-bad.yaml");
    const d = diagnostics.find((d) => d.rule === "structure/schema-keywords" && d.message.includes('"exclusiveMinimum" must be a number'));
    expect(d).toBeDefined();
  });

  test("flags non-numeric exclusiveMinimum/exclusiveMaximum node kinds on OpenAPI 3.1 (#41)", async () => {
    const diagnostics = await lintFixture("structure/schema-keywords-31-bad.yaml");
    const minDiagnostics = diagnostics.filter(
      (d) => d.rule === "structure/schema-keywords" && d.message.includes('"exclusiveMinimum" must be a number'),
    );
    const maxDiagnostics = diagnostics.filter(
      (d) => d.rule === "structure/schema-keywords" && d.message.includes('"exclusiveMaximum" must be a number'),
    );
    // BooleanExclusive (true), MapExclusive31 ({}), and NullExclusive31 (null) all use exclusiveMinimum.
    expect(minDiagnostics.length).toBeGreaterThanOrEqual(3);
    // SeqExclusive31 ([]) and StringExclusive31 ("5") both use exclusiveMaximum.
    expect(maxDiagnostics.length).toBeGreaterThanOrEqual(2);
    for (const d of [...minDiagnostics, ...maxDiagnostics]) {
      expect(typeof d.range.start.line).toBe("number");
    }
  });

  test("flags an unrecognized type name inside a 3.1 type array", async () => {
    const diagnostics = await lintFixture("structure/schema-keywords-31-bad.yaml");
    const d = diagnostics.find((d) => d.rule === "structure/schema-keywords" && d.message.includes('"type: potato"'));
    expect(d).toBeDefined();
  });

  test("flags a duplicate entry in a 3.1 type array", async () => {
    const diagnostics = await lintFixture("structure/schema-keywords-31-bad.yaml");
    const d = diagnostics.find((d) => d.rule === "structure/schema-keywords" && d.message.includes('"type" array contains duplicate entry "string"'));
    expect(d).toBeDefined();
  });

  test("flags a non-string/array type value in OpenAPI 3.1", async () => {
    const diagnostics = await lintFixture("structure/schema-keywords-31-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/schema-keywords" && d.message.includes('"type" must be a string or array of strings in OpenAPI 3.1'),
    );
    expect(d).toBeDefined();
  });

  test("flags a tuple-form items array in OpenAPI 3.1, suggesting prefixItems", async () => {
    const diagnostics = await lintFixture("structure/schema-keywords-31-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/schema-keywords" && d.message.includes('"items" must be a single schema object in OpenAPI 3.1') && d.message.includes("prefixItems"),
    );
    expect(d).toBeDefined();
  });

  test("flags minItems > maxItems", async () => {
    const diagnostics = await lintFixture("structure/schema-keywords-31-bad.yaml");
    const d = diagnostics.find((d) => d.rule === "structure/schema-keywords" && d.message.includes('"minItems" (5) is greater than "maxItems" (2)'));
    expect(d).toBeDefined();
  });

  test("does not flag sibling keys alongside $ref in OpenAPI 3.1 (legal there)", async () => {
    const diagnostics = await lintFixture("structure/schema-keywords-31-bad.yaml");
    const d = diagnostics.find((d) => d.rule === "structure/schema-keywords" && d.message.includes("Sibling keys alongside"));
    expect(d).toBeUndefined();
  });

  test("valid 3.0 fixture passes", async () => {
    const diagnostics = await lintFixture("valid/openapi.yaml");
    expect(diagnostics.some((d) => d.rule === "structure/schema-keywords")).toBe(false);
  });

  test("valid 3.1 fixture passes", async () => {
    const diagnostics = await lintFixture("structure/schema-keywords-valid-31.yaml");
    expect(diagnostics.some((d) => d.rule === "structure/schema-keywords")).toBe(false);
  });

  describe('"required" vs "additionalProperties: false" consistency accounts for 3.1 patternProperties', () => {
    const doc31 = (patternProperties: string) => `
openapi: 3.1.0
info:
  title: T
  version: "1.0.0"
paths: {}
components:
  schemas:
    Thing:
      type: object
      required: [foo_id]
      properties:
        name:
          type: string
      additionalProperties: false
${patternProperties}
`;

    test("a required name matched by a patternProperties regex is not flagged", async () => {
      const fs = new InMemoryFileSystem({
        "/virtual/entry.yaml": doc31("      patternProperties:\n        '^.*_id$':\n          type: integer"),
      });
      const graph = await loadWorkspaceGraph(fs, "/virtual/entry.yaml");
      const diagnostics = lint(graph, resolveConfig(undefined));
      expect(diagnostics.some((d) => d.rule === "structure/schema-keywords" && d.message.includes("can never be satisfied"))).toBe(false);
    });

    test("a required name matched by no patternProperties regex is still flagged", async () => {
      const fs = new InMemoryFileSystem({
        "/virtual/entry.yaml": doc31("      patternProperties:\n        '^bar_.*$':\n          type: integer"),
      });
      const graph = await loadWorkspaceGraph(fs, "/virtual/entry.yaml");
      const diagnostics = lint(graph, resolveConfig(undefined));
      const d = diagnostics.find(
        (d) => d.rule === "structure/schema-keywords" && d.message.includes('"required" lists "foo_id"') && d.message.includes("can never be satisfied"),
      );
      expect(d).toBeDefined();
    });

    test("an invalid patternProperties regex is skipped rather than crashing or false-positive matching", async () => {
      const fs = new InMemoryFileSystem({
        "/virtual/entry.yaml": doc31("      patternProperties:\n        '(unclosed':\n          type: integer"),
      });
      const graph = await loadWorkspaceGraph(fs, "/virtual/entry.yaml");
      const diagnostics = lint(graph, resolveConfig(undefined));
      const d = diagnostics.find(
        (d) => d.rule === "structure/schema-keywords" && d.message.includes('"required" lists "foo_id"') && d.message.includes("can never be satisfied"),
      );
      expect(d).toBeDefined();
    });

    test("3.0 documents don't get the patternProperties exemption (not a legal 3.0 keyword)", async () => {
      const doc30 = `
openapi: 3.0.3
info:
  title: T
  version: "1.0.0"
paths: {}
components:
  schemas:
    Thing:
      type: object
      required: [foo_id]
      properties:
        name:
          type: string
      additionalProperties: false
`;
      const fs = new InMemoryFileSystem({ "/virtual/entry.yaml": doc30 });
      const graph = await loadWorkspaceGraph(fs, "/virtual/entry.yaml");
      const diagnostics = lint(graph, resolveConfig(undefined));
      const d = diagnostics.find(
        (d) => d.rule === "structure/schema-keywords" && d.message.includes('"required" lists "foo_id"') && d.message.includes("can never be satisfied"),
      );
      expect(d).toBeDefined();
    });
  });
});

describe("structure/security-schemes", () => {
  test("flags a missing type", async () => {
    const diagnostics = await lintFixture("structure/security-schemes-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/security-schemes" && d.message.includes('"NoType"') && d.message.includes("missing required field \"type\""),
    );
    expect(d).toBeDefined();
  });

  test("flags an unrecognized type", async () => {
    const diagnostics = await lintFixture("structure/security-schemes-bad.yaml");
    const d = diagnostics.find((d) => d.rule === "structure/security-schemes" && d.message.includes('"BadType"'));
    expect(d?.message).toContain("madeUpType");
  });

  test("flags apiKey missing name", async () => {
    const diagnostics = await lintFixture("structure/security-schemes-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/security-schemes" && d.message.includes('"BadApiKey"') && d.message.includes('"name"'),
    );
    expect(d).toBeDefined();
  });

  test("flags http missing scheme", async () => {
    const diagnostics = await lintFixture("structure/security-schemes-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/security-schemes" && d.message.includes('"BadHttp"') && d.message.includes('"scheme"'),
    );
    expect(d).toBeDefined();
  });

  test("flags oauth2 with no flows defined", async () => {
    const diagnostics = await lintFixture("structure/security-schemes-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/security-schemes" && d.message.includes('"BadOAuth2NoFlows"') && d.message.includes('"flows"'),
    );
    expect(d).toBeDefined();
  });

  test("flags an oauth2 implicit flow missing authorizationUrl", async () => {
    const diagnostics = await lintFixture("structure/security-schemes-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/security-schemes" && d.message.includes('"BadOAuth2Flow"') && d.message.includes("authorizationUrl"),
    );
    expect(d).toBeDefined();
  });

  test("flags openIdConnect missing openIdConnectUrl", async () => {
    const diagnostics = await lintFixture("structure/security-schemes-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/security-schemes" && d.message.includes('"BadOpenIdConnect"') && d.message.includes("openIdConnectUrl"),
    );
    expect(d).toBeDefined();
  });

  test("accepts mutualTLS in OpenAPI 3.1", async () => {
    const diagnostics = await lintFixture("structure/security-schemes-mutualtls-31.yaml");
    expect(diagnostics.some((d) => d.rule === "structure/security-schemes")).toBe(false);
  });

  test("rejects mutualTLS in OpenAPI 3.0", async () => {
    const diagnostics = await lintFixture("structure/security-schemes-mutualtls-30.yaml");
    const d = diagnostics.find((d) => d.rule === "structure/security-schemes");
    expect(d?.message).toContain("mutualTLS");
  });

  test("valid fixture passes", async () => {
    const diagnostics = await lintFixture("valid/openapi.yaml");
    expect(diagnostics.some((d) => d.rule === "structure/security-schemes")).toBe(false);
  });
});

describe("structure/server-variables", () => {
  test("flags a url variable with no matching declaration", async () => {
    const diagnostics = await lintFixture("structure/server-variables-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/server-variables" && d.message.includes("missingVar"),
    );
    expect(d).toBeDefined();
  });

  test("flags a default not listed in enum", async () => {
    const diagnostics = await lintFixture("structure/server-variables-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/server-variables" && d.message.includes('"basePath"') && d.message.includes("enum"),
    );
    expect(d).toBeDefined();
  });

  test("warns about a declared variable unused by the url", async () => {
    const diagnostics = await lintFixture("structure/server-variables-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/server-variables" && d.message.includes('"unused"') && d.message.includes("not referenced"),
    );
    expect(d).toBeDefined();
    expect(d?.severity).toBe("warn");
  });

  test("flags a variable missing a default", async () => {
    const diagnostics = await lintFixture("structure/server-variables-missing-default.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/server-variables" && d.message.includes('"host"') && d.message.includes('"default"'),
    );
    expect(d).toBeDefined();
  });

  test("valid fixture passes", async () => {
    const diagnostics = await lintFixture("valid/openapi.yaml");
    expect(diagnostics.some((d) => d.rule === "structure/server-variables")).toBe(false);
  });

  describe("malformed Server Object shape (#45)", () => {
    test("flags a root server missing url", async () => {
      const diagnostics = await lintFixture("structure/server-variables-malformed.yaml");
      const d = diagnostics.find(
        (d) => d.rule === "structure/server-variables" && d.message.includes("Root") && d.message.includes('missing required field "url"'),
      );
      expect(d).toBeDefined();
    });

    test("flags a root server with a non-string url", async () => {
      const diagnostics = await lintFixture("structure/server-variables-malformed.yaml");
      const d = diagnostics.find(
        (d) => d.rule === "structure/server-variables" && d.message.includes('"url" must be a string'),
      );
      expect(d).toBeDefined();
    });

    test("flags a root server whose variables is not an object", async () => {
      const diagnostics = await lintFixture("structure/server-variables-malformed.yaml");
      const d = diagnostics.find(
        (d) => d.rule === "structure/server-variables" && d.message.includes('"variables" must be an object'),
      );
      expect(d).toBeDefined();
    });

    test("flags a declared variable missing default even when url is also missing", async () => {
      const diagnostics = await lintFixture("structure/server-variables-malformed.yaml");
      const d = diagnostics.find(
        (d) =>
          d.rule === "structure/server-variables" &&
          d.message.includes('"host"') &&
          d.message.includes('missing required field "default"'),
      );
      expect(d).toBeDefined();
    });

    test("flags a non-object item in a servers array (path item level)", async () => {
      const diagnostics = await lintFixture("structure/server-variables-malformed.yaml");
      const d = diagnostics.find(
        (d) => d.rule === "structure/server-variables" && d.message.includes("Path item") && d.message.includes("must be an object"),
      );
      expect(d).toBeDefined();
    });

    test("flags an operation-level server missing url", async () => {
      const diagnostics = await lintFixture("structure/server-variables-malformed.yaml");
      const d = diagnostics.find(
        (d) =>
          d.rule === "structure/server-variables" &&
          d.message.includes("Operation") &&
          d.message.includes('missing required field "url"'),
      );
      expect(d).toBeDefined();
    });
  });
});

describe("structure/encoding", () => {
  test("flags an encoding key with no matching schema property", async () => {
    const diagnostics = await lintFixture("structure/encoding-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/encoding" && d.message.includes("notAProperty"),
    );
    expect(d).toBeDefined();
  });

  test("flags a wrong-typed contentType", async () => {
    const diagnostics = await lintFixture("structure/encoding-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/encoding" && d.message.includes('"metadata"') && d.message.includes("contentType"),
    );
    expect(d).toBeDefined();
  });

  test("flags an invalid style value", async () => {
    const diagnostics = await lintFixture("structure/encoding-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/encoding" && d.message.includes('"metadata"') && d.message.includes('"style"'),
    );
    expect(d).toBeDefined();
  });

  test("flags non-boolean explode/allowReserved", async () => {
    const diagnostics = await lintFixture("structure/encoding-bad.yaml");
    const explodeDiag = diagnostics.find(
      (d) => d.rule === "structure/encoding" && d.message.includes('"metadata"') && d.message.includes('"explode"'),
    );
    const allowReservedDiag = diagnostics.find(
      (d) => d.rule === "structure/encoding" && d.message.includes('"metadata"') && d.message.includes('"allowReserved"'),
    );
    expect(explodeDiag).toBeDefined();
    expect(allowReservedDiag).toBeDefined();
  });

  test("valid fixture passes", async () => {
    const diagnostics = await lintFixture("valid/openapi.yaml");
    expect(diagnostics.some((d) => d.rule === "structure/encoding")).toBe(false);
  });
});

describe("structure/xml", () => {
  test("flags an unknown key", async () => {
    const diagnostics = await lintFixture("structure/xml-bad.yaml");
    const d = diagnostics.find((d) => d.rule === "structure/xml" && d.message.includes("unknownKey"));
    expect(d).toBeDefined();
  });

  test("flags a wrong-typed name", async () => {
    const diagnostics = await lintFixture("structure/xml-bad.yaml");
    const d = diagnostics.find((d) => d.rule === "structure/xml" && d.message.includes("xml.name"));
    expect(d).toBeDefined();
  });

  test("flags a namespace that isn't an absolute URI", async () => {
    const diagnostics = await lintFixture("structure/xml-bad.yaml");
    const d = diagnostics.find((d) => d.rule === "structure/xml" && d.message.includes("xml.namespace"));
    expect(d).toBeDefined();
  });

  test("flags a non-boolean attribute", async () => {
    const diagnostics = await lintFixture("structure/xml-bad.yaml");
    const d = diagnostics.find((d) => d.rule === "structure/xml" && d.message.includes("xml.attribute"));
    expect(d).toBeDefined();
  });

  test("valid fixture passes", async () => {
    const diagnostics = await lintFixture("valid/openapi.yaml");
    expect(diagnostics.some((d) => d.rule === "structure/xml")).toBe(false);
  });
});

describe("structure/examples", () => {
  test("flags value and externalValue together on a component example", async () => {
    const diagnostics = await lintFixture("structure/examples-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/examples" && d.message.includes('"BadRootExample"') && d.message.includes("must not set both"),
    );
    expect(d).toBeDefined();
  });

  test("flags an unknown key on an inline parameter example", async () => {
    const diagnostics = await lintFixture("structure/examples-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/examples" && d.message.includes('"bad"') && d.message.includes("unknown key"),
    );
    expect(d).toBeDefined();
  });

  test("flags value and externalValue together on an inline parameter example", async () => {
    const diagnostics = await lintFixture("structure/examples-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/examples" && d.message.includes('"bad"') && d.message.includes("must not set both"),
    );
    expect(d).toBeDefined();
  });

  test("valid fixture passes", async () => {
    const diagnostics = await lintFixture("valid/openapi.yaml");
    expect(diagnostics.some((d) => d.rule === "structure/examples")).toBe(false);
  });
});

describe("structure/discriminator", () => {
  test("flags a discriminator with no oneOf/anyOf/allOf", async () => {
    const diagnostics = await lintFixture("structure/discriminator-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/discriminator" && d.message.includes("none of"),
    );
    expect(d).toBeDefined();
  });

  test("flags a missing propertyName", async () => {
    const diagnostics = await lintFixture("structure/discriminator-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/discriminator" && d.message.includes("missing required field \"propertyName\""),
    );
    expect(d).toBeDefined();
  });

  test("flags an unresolvable mapping target", async () => {
    const diagnostics = await lintFixture("structure/discriminator-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/discriminator" && d.message.includes("NoSuchSchema"),
    );
    expect(d).toBeDefined();
  });

  test("does not flag a resolvable mapping target", async () => {
    const diagnostics = await lintFixture("structure/discriminator-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/discriminator" && d.message.includes('"cat"'),
    );
    expect(d).toBeUndefined();
  });

  test("flags a oneOf branch missing the discriminator property", async () => {
    const diagnostics = await lintFixture("structure/discriminator-bad.yaml");
    // NoPropertyBranch (lines 68-72, 1-indexed) is the branch missing "petType".
    const d = diagnostics.find(
      (d) =>
        d.rule === "structure/discriminator" &&
        d.message.includes("is not defined in") &&
        d.range.start.line >= 67 &&
        d.range.start.line <= 71,
    );
    expect(d).toBeDefined();
  });

  test("flags a 3.0 branch where the discriminator property is not required", async () => {
    const diagnostics = await lintFixture("structure/discriminator-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/discriminator" && d.message.includes("must be listed in \"required\""),
    );
    expect(d).toBeDefined();
  });

  test("does not require the discriminator property to be required in 3.1", async () => {
    const diagnostics = await lintFixture("structure/discriminator-31-required-ok.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/discriminator" && d.message.includes("required"),
    );
    expect(d).toBeUndefined();
  });

  test("valid fixture passes", async () => {
    const diagnostics = await lintFixture("valid/openapi.yaml");
    expect(diagnostics.some((d) => d.rule === "structure/discriminator")).toBe(false);
  });
});

describe("structure/callbacks", () => {
  test("flags a callback expression that doesn't look like a runtime expression or URL", async () => {
    const diagnostics = await lintFixture("structure/callbacks-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/callbacks" && d.message.includes("notAnExpression"),
    );
    expect(d).toBeDefined();
  });

  test("flags an invalid key in a callback path item", async () => {
    const diagnostics = await lintFixture("structure/callbacks-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/callbacks" && d.message.includes('"fetch"'),
    );
    expect(d).toBeDefined();
  });

  test("flags a callback operation missing responses", async () => {
    const diagnostics = await lintFixture("structure/callbacks-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/callbacks" && d.message.includes("missingResponses") && d.message.includes("responses"),
    );
    expect(d).toBeDefined();
  });

  test("does not flag a well-formed callback", async () => {
    const diagnostics = await lintFixture("structure/callbacks-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/callbacks" && d.message.includes("onData"),
    );
    expect(d).toBeUndefined();
  });

  test("checks components/callbacks too", async () => {
    const diagnostics = await lintFixture("structure/callbacks-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/callbacks" && d.message.includes("ReusableCallback"),
    );
    expect(d).toBeUndefined();
  });

  test("valid fixture passes", async () => {
    const diagnostics = await lintFixture("valid/openapi.yaml");
    expect(diagnostics.some((d) => d.rule === "structure/callbacks")).toBe(false);
  });
});

describe("structure/links", () => {
  test("flags both operationRef and operationId set", async () => {
    const diagnostics = await lintFixture("structure/links-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/links" && d.message.includes("BothSet") && d.message.includes("must not set both"),
    );
    expect(d).toBeDefined();
  });

  test("flags neither operationRef nor operationId set", async () => {
    const diagnostics = await lintFixture("structure/links-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/links" && d.message.includes("NeitherSet") && d.message.includes("exactly one"),
    );
    expect(d).toBeDefined();
  });

  test("flags an operationId that doesn't exist", async () => {
    const diagnostics = await lintFixture("structure/links-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/links" && d.message.includes("doesNotExist"),
    );
    expect(d).toBeDefined();
  });

  test("flags an unresolvable local operationRef", async () => {
    const diagnostics = await lintFixture("structure/links-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/links" && d.message.includes("BadRef") && d.message.includes("does not resolve"),
    );
    expect(d).toBeDefined();
  });

  test("does not flag a resolvable local operationRef", async () => {
    const diagnostics = await lintFixture("structure/links-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/links" && d.message.includes("GoodRef"),
    );
    expect(d).toBeUndefined();
  });

  test("flags an unknown key", async () => {
    const diagnostics = await lintFixture("structure/links-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/links" && d.message.includes("notAKey"),
    );
    expect(d).toBeDefined();
  });

  test("checks components/links too", async () => {
    const diagnostics = await lintFixture("structure/links-bad.yaml");
    const d = diagnostics.find(
      (d) => d.rule === "structure/links" && d.message.includes("alsoDoesNotExist"),
    );
    expect(d).toBeDefined();
  });

  test("valid fixture passes", async () => {
    const diagnostics = await lintFixture("valid/openapi.yaml");
    expect(diagnostics.some((d) => d.rule === "structure/links")).toBe(false);
  });
});

describe("structure/discriminator and structure/links across $ref'd multi-file documents", () => {
  test("flags an unresolvable discriminator mapping target and an unresolvable link operationId, each in the file that defines them", async () => {
    const fs = new NodeFileSystem();
    const entry = `${fixturesRoot}/structure-multifile-v2/entry.yaml`;
    const graph = await loadWorkspaceGraph(fs, entry);
    const config = resolveConfig(undefined);
    const diagnostics = lint(graph, config);

    const mappingDiag = diagnostics.find(
      (d) => d.rule === "structure/discriminator" && d.message.includes("MissingDog"),
    );
    expect(mappingDiag).toBeDefined();
    expect(mappingDiag?.range.filePath).toContain("entry.yaml");

    const okMappingDiag = diagnostics.find(
      (d) => d.rule === "structure/discriminator" && d.message.includes('"cat"'),
    );
    expect(okMappingDiag).toBeUndefined();

    const linkDiag = diagnostics.find(
      (d) => d.rule === "structure/links" && d.message.includes("unknownOperation"),
    );
    expect(linkDiag).toBeDefined();
    expect(linkDiag?.range.filePath).toContain("responses.yaml");

    const goodLinkDiag = diagnostics.find(
      (d) => d.rule === "structure/links" && d.message.includes("GetPet") && d.message.includes("does not match"),
    );
    expect(goodLinkDiag).toBeUndefined();
  });
});

describe("structure rules across $ref'd multi-file documents", () => {
  test("flags a $ref'd security scheme and a $ref'd example", async () => {
    const fs = new NodeFileSystem();
    const entry = `${fixturesRoot}/structure-multifile/entry.yaml`;
    const graph = await loadWorkspaceGraph(fs, entry);
    const config = resolveConfig(undefined);
    const diagnostics = lint(graph, config);

    const schemeDiag = diagnostics.find(
      (d) => d.rule === "structure/security-schemes" && d.message.includes('"ApiKeyAuth"'),
    );
    expect(schemeDiag).toBeDefined();
    expect(schemeDiag?.range.filePath).toContain("security-schemes.yaml");

    const exampleDiag = diagnostics.find(
      (d) => d.rule === "structure/examples" && d.message.includes('"pet"') && d.message.includes("must not set both"),
    );
    expect(exampleDiag).toBeDefined();
    expect(exampleDiag?.range.filePath).toContain("examples.yaml");
  });
});

describe("structure/http-methods and structure/field-types across a $ref'd path item", () => {
  test("both rules follow the path item $ref and attribute diagnostics to the target file", async () => {
    const fs = new NodeFileSystem();
    const entry = `${fixturesRoot}/structure-multifile-methods/entry.yaml`;
    const graph = await loadWorkspaceGraph(fs, entry);
    const config = resolveConfig(undefined);
    const diagnostics = lint(graph, config);

    const methodDiag = diagnostics.find((d) => d.rule === "structure/http-methods" && d.message.includes("fetch"));
    expect(methodDiag).toBeDefined();
    expect(methodDiag?.range.filePath).toContain("paths-pets.yaml");

    const fieldTypeDiag = diagnostics.find((d) => d.rule === "structure/field-types" && d.message.includes("tags"));
    expect(fieldTypeDiag).toBeDefined();
    expect(fieldTypeDiag?.range.filePath).toContain("paths-pets.yaml");
  });
});

describe('Operation "responses" requiredness by version', () => {
  const docWithoutResponses = (version: string) => `
openapi: ${version}
info:
  title: T
  version: "1.0.0"
paths:
  /ping:
    get:
      operationId: ping
      tags: [a]
      description: x
`;

  test('3.0: structure/field-types reports a missing "responses"', async () => {
    const fs = new InMemoryFileSystem({ "/virtual/entry.yaml": docWithoutResponses("3.0.3") });
    const graph = await loadWorkspaceGraph(fs, "/virtual/entry.yaml");
    const diagnostics = lint(graph, resolveConfig(undefined));
    const d = diagnostics.find((d) => d.rule === "structure/field-types" && d.message.includes('missing required field "responses"'));
    expect(d).toBeDefined();
    expect(d?.severity).toBe("error");
  });

  test('3.1: structure/field-types accepts an operation without "responses" (optional since 3.1)', async () => {
    const fs = new InMemoryFileSystem({ "/virtual/entry.yaml": docWithoutResponses("3.1.0") });
    const graph = await loadWorkspaceGraph(fs, "/virtual/entry.yaml");
    const diagnostics = lint(graph, resolveConfig(undefined));
    expect(
      diagnostics.some((d) => d.rule === "structure/field-types" && d.message.includes('missing required field "responses"')),
    ).toBe(false);
  });

  const callbackDoc = (version: string) => `
openapi: ${version}
info:
  title: T
  version: "1.0.0"
paths:
  /subscribe:
    post:
      operationId: subscribe
      tags: [a]
      description: x
      callbacks:
        onData:
          "{$request.body#/callbackUrl}":
            post:
              operationId: onData
      responses:
        '200':
          description: OK
`;

  test('3.0: structure/callbacks reports a callback operation missing "responses"', async () => {
    const fs = new InMemoryFileSystem({ "/virtual/entry.yaml": callbackDoc("3.0.3") });
    const graph = await loadWorkspaceGraph(fs, "/virtual/entry.yaml");
    const diagnostics = lint(graph, resolveConfig(undefined));
    expect(
      diagnostics.some((d) => d.rule === "structure/callbacks" && d.message.includes('missing required field "responses"')),
    ).toBe(true);
  });

  test('3.1: structure/callbacks accepts a callback operation without "responses"', async () => {
    const fs = new InMemoryFileSystem({ "/virtual/entry.yaml": callbackDoc("3.1.0") });
    const graph = await loadWorkspaceGraph(fs, "/virtual/entry.yaml");
    const diagnostics = lint(graph, resolveConfig(undefined));
    expect(
      diagnostics.some((d) => d.rule === "structure/callbacks" && d.message.includes('missing required field "responses"')),
    ).toBe(false);
  });
});

describe("structure/http-methods and structure/field-types on 3.1 webhooks", () => {
  test("structure/http-methods flags an invalid key under a webhook path item", async () => {
    const fs = new InMemoryFileSystem({
      "/virtual/entry.yaml": `
openapi: 3.1.0
info:
  title: Webhooks
  version: "1.0.0"
paths: {}
webhooks:
  newPet:
    fetch:
      operationId: onNewPet
      responses:
        '200':
          description: OK
`,
    });
    const graph = await loadWorkspaceGraph(fs, "/virtual/entry.yaml");
    const diagnostics = lint(graph, resolveConfig(undefined));
    const d = diagnostics.find((d) => d.rule === "structure/http-methods" && d.message.includes("fetch"));
    expect(d).toBeDefined();
  });

  test("structure/field-types flags a wrong-typed field on a webhook operation", async () => {
    const fs = new InMemoryFileSystem({
      "/virtual/entry.yaml": `
openapi: 3.1.0
info:
  title: Webhooks
  version: "1.0.0"
paths: {}
webhooks:
  newPet:
    post:
      operationId: onNewPet
      tags: notanarray
      responses:
        '200':
          description: OK
`,
    });
    const graph = await loadWorkspaceGraph(fs, "/virtual/entry.yaml");
    const diagnostics = lint(graph, resolveConfig(undefined));
    const d = diagnostics.find((d) => d.rule === "structure/field-types" && d.message.includes("tags"));
    expect(d).toBeDefined();
  });
});
