import { describe, expect, test } from "bun:test";
import type { OpenApiVersion } from "@oasis/core";
import { keyCompletionsForPointer } from "../src/handlers/completion.ts";
import { classifyPointer } from "../src/keywords.ts";

/**
 * Issue #60: completion contexts must cover every OpenAPI Object location and Schema Object
 * applicator, and must offer version-correct keys for 3.0 vs 3.1. These tests drive the shared
 * object-shape table (from `@oasis/linter`) through `classifyPointer` + `keyCompletionsForPointer`
 * at each location, checking the classified kind and a representative key from the suggestions.
 */

function labelsAt(pointer: string, version: OpenApiVersion): string[] {
  return keyCompletionsForPointer(pointer, version).map((i) => i.label);
}

const P = (s: string) => s; // readability helper for pointers

describe("classifyPointer covers all component sections", () => {
  const cases: Array<[string, string]> = [
    ["/components/schemas/Foo", "schema"],
    ["/components/parameters/Foo", "parameter"],
    ["/components/requestBodies/Foo", "requestBody"],
    ["/components/responses/Foo", "response"],
    ["/components/securitySchemes/Foo", "securityScheme"],
    ["/components/headers/Foo", "header"],
    ["/components/examples/Foo", "example"],
    ["/components/links/Foo", "link"],
    ["/components/callbacks/Foo", "callback"],
  ];
  for (const [pointer, kind] of cases) {
    test(`${pointer} -> ${kind}`, () => {
      expect(classifyPointer(pointer)).toBe(kind as ReturnType<typeof classifyPointer>);
    });
  }

  test("3.1-only components/pathItems classifies to a Path Item", () => {
    expect(classifyPointer("/components/pathItems/Foo")).toBe("pathItem");
  });

  test("a Path Item under components/pathItems offers operation keys", () => {
    const labels = labelsAt("/components/pathItems/Foo", "3.1");
    expect(labels).toContain("get");
    expect(labels).toContain("parameters");
  });
});

describe("root webhooks (3.1)", () => {
  test("root offers webhooks/jsonSchemaDialect only in 3.1", () => {
    expect(labelsAt("", "3.1")).toContain("webhooks");
    expect(labelsAt("", "3.1")).toContain("jsonSchemaDialect");
    expect(labelsAt("", "3.0")).not.toContain("webhooks");
    expect(labelsAt("", "3.0")).not.toContain("jsonSchemaDialect");
  });

  test("a webhook path item offers operation keys", () => {
    expect(classifyPointer("/webhooks/newPet")).toBe("pathItem");
    const opLabels = labelsAt("/webhooks/newPet/post", "3.1");
    expect(opLabels).toContain("operationId");
    expect(opLabels).toContain("responses");
  });
});

describe("component object key completions", () => {
  test("Header Object offers header keys", () => {
    const labels = labelsAt("/components/headers/RateLimit", "3.1");
    expect(labels).toContain("schema");
    expect(labels).toContain("description");
    expect(labels).not.toContain("name"); // headers have no `name` (unlike parameters)
    expect(labels).not.toContain("in");
  });

  test("Example Object offers example keys", () => {
    const labels = labelsAt("/components/examples/Pet", "3.1");
    expect(labels).toContain("value");
    expect(labels).toContain("externalValue");
    expect(labels).toContain("summary");
  });

  test("Link Object offers link keys", () => {
    const labels = labelsAt("/components/links/GetUser", "3.1");
    expect(labels).toContain("operationRef");
    expect(labels).toContain("operationId");
    expect(labels).toContain("parameters");
  });

  test("Callback -> Path Item -> Operation chain classifies", () => {
    expect(classifyPointer("/components/callbacks/onData")).toBe("callback");
    // Callback keys are runtime expressions; here one without a literal `/` so a single JSON
    // Pointer segment holds the whole expression.
    expect(classifyPointer("/components/callbacks/onData/{$request.query.url}")).toBe("pathItem");
    expect(classifyPointer("/components/callbacks/onData/{$request.query.url}/post")).toBe("operation");
  });

  test("Security Scheme flows classify to OAuth Flows / Flow", () => {
    expect(classifyPointer("/components/securitySchemes/oauth/flows")).toBe("oauthFlows");
    expect(classifyPointer("/components/securitySchemes/oauth/flows/authorizationCode")).toBe("oauthFlow");
    const flowLabels = labelsAt("/components/securitySchemes/oauth/flows/authorizationCode", "3.1");
    expect(flowLabels).toContain("authorizationUrl");
    expect(flowLabels).toContain("tokenUrl");
    expect(flowLabels).toContain("scopes");
  });
});

describe("JSON Schema 2020-12 applicators (3.1)", () => {
  const schemaApplicators: string[] = [
    "/components/schemas/Foo/$defs/Bar",
    "/components/schemas/Foo/prefixItems/0",
    "/components/schemas/Foo/patternProperties/^x-",
    "/components/schemas/Foo/if",
    "/components/schemas/Foo/then",
    "/components/schemas/Foo/else",
    "/components/schemas/Foo/dependentSchemas/a",
    "/components/schemas/Foo/unevaluatedProperties",
    "/components/schemas/Foo/unevaluatedItems",
    "/components/schemas/Foo/propertyNames",
    "/components/schemas/Foo/contains",
  ];
  for (const pointer of schemaApplicators) {
    test(`${pointer} classifies to a Schema Object`, () => {
      expect(classifyPointer(pointer)).toBe("schema");
    });
  }

  test("nested schema under $defs offers 3.1 schema keys, not 3.0 ones", () => {
    const labels = labelsAt(P("/components/schemas/Foo/$defs/Bar"), "3.1");
    expect(labels).toContain("const");
    expect(labels).toContain("prefixItems");
    expect(labels).not.toContain("nullable");
  });
});

describe("version-specific schema fields", () => {
  test("3.0 schema offers nullable/example, not const/examples", () => {
    const labels = labelsAt("/components/schemas/Pet", "3.0");
    expect(labels).toContain("nullable");
    expect(labels).toContain("example");
    expect(labels).not.toContain("const");
    expect(labels).not.toContain("examples");
    expect(labels).not.toContain("$defs");
  });

  test("3.1 schema offers const/examples/$defs, not nullable", () => {
    const labels = labelsAt("/components/schemas/Pet", "3.1");
    expect(labels).toContain("const");
    expect(labels).toContain("examples");
    expect(labels).toContain("$defs");
    expect(labels).not.toContain("nullable");
  });

  test("Info offers 3.1-only summary only in 3.1", () => {
    expect(labelsAt("/info", "3.1")).toContain("summary");
    expect(labelsAt("/info", "3.0")).not.toContain("summary");
  });

  test("License offers 3.1-only identifier only in 3.1", () => {
    expect(labelsAt("/info/license", "3.1")).toContain("identifier");
    expect(labelsAt("/info/license", "3.0")).not.toContain("identifier");
  });
});

describe("encoding and nested response contexts", () => {
  test("media type encoding entry classifies to an Encoding Object", () => {
    const pointer = "/paths/~1pets/post/requestBody/content/application~1json/encoding/photo";
    expect(classifyPointer(pointer)).toBe("encoding");
    const labels = labelsAt(pointer, "3.1");
    expect(labels).toContain("contentType");
    expect(labels).toContain("headers");
  });

  test("response header classifies to a Header Object", () => {
    const pointer = "/paths/~1pets/get/responses/200/headers/X-Rate";
    expect(classifyPointer(pointer)).toBe("header");
  });

  test("response link classifies to a Link Object", () => {
    const pointer = "/paths/~1pets/get/responses/200/links/self";
    expect(classifyPointer(pointer)).toBe("link");
  });
});
