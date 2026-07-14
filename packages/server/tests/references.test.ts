import { describe, expect, test } from "bun:test";
import { InMemoryFileSystem } from "@oasis/core";
import { getReferences } from "../src/handlers/references.ts";
import { scanWorkspaceRootsForProjects } from "../src/project.ts";
import { createServerContext } from "../src/workspace.ts";
import { positionOf } from "./helpers.ts";
import { ENTRY_PATH, ENTRY_TEXT, FRAGMENT_PATH, FRAGMENT_TEXT, ROOT, refsFixtureFiles } from "./refs-fixtures.ts";
import { ENTRY_A_PATH, ENTRY_B_PATH, ROOT as MULTI_ROOT, SHARED_PATH, SHARED_TEXT, multiEntryFiles } from "./multi-entry-fixtures.ts";

async function contextWithProject() {
  const ctx = createServerContext(new InMemoryFileSystem(refsFixtureFiles()));
  await scanWorkspaceRootsForProjects(ctx, [ROOT]);
  return ctx;
}

/** The three `$ref`s that resolve to `Pet`: two in the fragment file, one within the entry. */
function expectAllPetRefs(results: { filePath: string }[]) {
  const byFile = results.map((r) => r.filePath).sort();
  expect(byFile).toEqual([ENTRY_PATH, FRAGMENT_PATH, FRAGMENT_PATH].sort());
}

describe("getReferences", () => {
  test("from the definition key finds every $ref across the graph", async () => {
    const ctx = await contextWithProject();
    const position = positionOf(ENTRY_TEXT, "Pet:");

    const results = await getReferences(ctx, { path: ENTRY_PATH, position, includeDeclaration: false });

    expect(results).toHaveLength(3);
    expectAllPetRefs(results);
  });

  test("from inside the component's subtree finds the same references", async () => {
    const ctx = await contextWithProject();
    // Cursor on "type: object" inside the Pet schema body, not on the key itself.
    const position = positionOf(ENTRY_TEXT, "type: object");

    const results = await getReferences(ctx, { path: ENTRY_PATH, position, includeDeclaration: false });

    expect(results).toHaveLength(3);
    expectAllPetRefs(results);
  });

  test("from a $ref value resolves to the target first, then finds all references to it", async () => {
    const ctx = await contextWithProject();
    const position = positionOf(FRAGMENT_TEXT, "../openapi.yaml#/components/schemas/Pet");

    const results = await getReferences(ctx, { path: FRAGMENT_PATH, position, includeDeclaration: false });

    expect(results).toHaveLength(3);
    expectAllPetRefs(results);
  });

  test("includeDeclaration: false omits the definition site", async () => {
    const ctx = await contextWithProject();
    const position = positionOf(ENTRY_TEXT, "Pet:");
    const declLine = ENTRY_TEXT.split("\n").findIndex((l) => l.trim() === "Pet:");

    const results = await getReferences(ctx, { path: ENTRY_PATH, position, includeDeclaration: false });

    expect(results).toHaveLength(3);
    expect(results.some((r) => r.filePath === ENTRY_PATH && r.range.start.line === declLine)).toBe(false);
  });

  test("includeDeclaration: true includes the component key range", async () => {
    const ctx = await contextWithProject();
    const position = positionOf(ENTRY_TEXT, "Pet:");

    const results = await getReferences(ctx, { path: ENTRY_PATH, position, includeDeclaration: true });

    expect(results).toHaveLength(4);
    const declLine = ENTRY_TEXT.split("\n").findIndex((l) => l.trim() === "Pet:");
    const decl = results.find((r) => r.filePath === ENTRY_PATH && r.range.start.line === declLine);
    expect(decl).toBeDefined();
    const declLineText = ENTRY_TEXT.split("\n")[declLine]!;
    expect(declLineText.slice(decl!.range.start.character, decl!.range.end.character)).toBe("Pet");
  });

  test("cross-file references include the fragment file in project mode", async () => {
    const ctx = await contextWithProject();
    const position = positionOf(ENTRY_TEXT, "Pet:");

    const results = await getReferences(ctx, { path: ENTRY_PATH, position, includeDeclaration: false });

    const fragmentRefs = results.filter((r) => r.filePath === FRAGMENT_PATH);
    expect(fragmentRefs).toHaveLength(2);
  });

  test("cursor not on a component returns an empty list", async () => {
    const ctx = await contextWithProject();
    const position = positionOf(FRAGMENT_TEXT, "listPets");

    const results = await getReferences(ctx, { path: FRAGMENT_PATH, position, includeDeclaration: false });

    expect(results).toEqual([]);
  });
});

describe("getReferences with nested component-pointer references (#55)", () => {
  const ENTRY = "/nested/openapi.yaml";
  const TEXT = `openapi: 3.1.0
info:
  title: Test
  version: "1.0.0"
paths: {}
components:
  schemas:
    Pet:
      type: object
      properties:
        id:
          type: string
    PetId:
      $ref: '#/components/schemas/Pet/properties/id'
    PetRef:
      $ref: '#/components/schemas/Pet'
`;

  test("a $ref into a nested pointer under the component counts as a reference to it", async () => {
    const ctx = createServerContext(new InMemoryFileSystem({ [ENTRY]: TEXT }));
    const position = positionOf(TEXT, "Pet:");

    const results = await getReferences(ctx, { path: ENTRY, position, includeDeclaration: false });

    expect(results).toHaveLength(2);
    const lines = new Set(results.map((r) => r.range.start.line));
    expect(lines.has(positionOf(TEXT, "#/components/schemas/Pet/properties/id").line)).toBe(true);
    expect(lines.has(positionOf(TEXT, "'#/components/schemas/Pet'").line)).toBe(true);
  });
});

describe("getReferences with name-based references (#54)", () => {
  const PATH = "/named/openapi.yaml";
  const TEXT = `openapi: 3.1.0
info:
  title: Test
  version: "1.0.0"
security:
  - ApiKey: []
paths:
  /pets:
    get:
      operationId: listPets
      security:
        - ApiKey: []
      responses:
        '200':
          description: OK
components:
  securitySchemes:
    ApiKey:
      type: apiKey
      name: X-API-Key
      in: header
  schemas:
    Animal:
      type: object
      discriminator:
        propertyName: kind
        mapping:
          dog: Dog
      oneOf:
        - $ref: '#/components/schemas/Dog'
    Dog:
      type: object
`;

  function namedCtx() {
    return createServerContext(new InMemoryFileSystem({ [PATH]: TEXT }));
  }

  test("security scheme references include root and operation Security Requirement keys", async () => {
    const position = positionOf(TEXT, "ApiKey:", 2); // the definition key under securitySchemes

    const results = await getReferences(namedCtx(), { path: PATH, position, includeDeclaration: false });

    expect(results).toHaveLength(2);
    const lines = new Set(results.map((r) => r.range.start.line));
    expect(lines.has(positionOf(TEXT, "- ApiKey: []").line)).toBe(true);
    expect(lines.has(positionOf(TEXT, "- ApiKey: []", 1).line)).toBe(true);
  });

  test("find references works FROM a Security Requirement key position", async () => {
    const position = positionOf(TEXT, "ApiKey: []"); // root-level requirement key

    const results = await getReferences(namedCtx(), { path: PATH, position, includeDeclaration: true });

    expect(results).toHaveLength(3); // two requirement keys + the declaration
  });

  test("schema references include a bare discriminator mapping name", async () => {
    const position = positionOf(TEXT, "Dog:");

    const results = await getReferences(namedCtx(), { path: PATH, position, includeDeclaration: false });

    expect(results).toHaveLength(2);
    const lines = new Set(results.map((r) => r.range.start.line));
    expect(lines.has(positionOf(TEXT, "dog: Dog").line)).toBe(true);
    expect(lines.has(positionOf(TEXT, "$ref: '#/components/schemas/Dog'").line)).toBe(true);
  });
});

describe("getReferences ignores lookalikes in literal data contexts (#118)", () => {
  const PATH = "/ctx/openapi.yaml";
  // `security` and `discriminator.mapping` structures also appear inside literal-data contexts
  // (`example`, `default`, `enum`, `const`, and an `x-*` vendor extension). Only the genuine
  // Security Requirement Objects (root + operation) and the discriminator on a real Schema Object
  // are semantic references; the payload copies must be invisible to find-references.
  const TEXT = `openapi: 3.1.0
info:
  title: Test
  version: "1.0.0"
security:
  - Auth: []
paths:
  /pets:
    get:
      operationId: listPets
      security:
        - Auth: []
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                type: object
                properties:
                  kind:
                    type: string
                example:
                  security:
                    - Auth: []
                  discriminator:
                    mapping:
                      dog: Dog
                default:
                  security:
                    - Auth: []
                enum:
                  - security:
                      - Auth: []
                x-vendor:
                  security:
                    - Auth: []
components:
  securitySchemes:
    Auth:
      type: http
      scheme: basic
  schemas:
    Animal:
      type: object
      discriminator:
        propertyName: kind
        mapping:
          dog: Dog
      oneOf:
        - $ref: '#/components/schemas/Dog'
    Dog:
      type: object
    Fake:
      type: object
      const:
        discriminator:
          mapping:
            dog: Dog
`;

  function namedCtx() {
    return createServerContext(new InMemoryFileSystem({ [PATH]: TEXT }));
  }

  test("security-scheme references skip Security Requirement lookalikes under literal data", async () => {
    // "Auth:" also matches the six `- Auth: []` requirement copies; the definition key is the 7th.
    const position = positionOf(TEXT, "Auth:", 6); // definition key under securitySchemes
    const results = await getReferences(namedCtx(), { path: PATH, position, includeDeclaration: false });

    // Only the root and operation Security Requirement keys, never the example/default/enum/x-* copies.
    expect(results).toHaveLength(2);
    const lines = results.map((r) => r.range.start.line).sort((a, b) => a - b);
    expect(lines).toEqual([positionOf(TEXT, "- Auth: []").line, positionOf(TEXT, "- Auth: []", 1).line].sort((a, b) => a - b));
  });

  test("schema references skip discriminator mapping lookalikes under literal data", async () => {
    const position = positionOf(TEXT, "Dog:"); // definition key under schemas
    const results = await getReferences(namedCtx(), { path: PATH, position, includeDeclaration: false });

    // Only the real discriminator mapping value and the $ref, never the example/const copies.
    expect(results).toHaveLength(2);
    const lines = new Set(results.map((r) => r.range.start.line));
    // The genuine mapping is the one under Animal's discriminator (occurrence index 1 of "dog: Dog"):
    // index 0 is the example copy, index 2 the const copy.
    expect(lines.has(positionOf(TEXT, "dog: Dog", 1).line)).toBe(true);
    expect(lines.has(positionOf(TEXT, "$ref: '#/components/schemas/Dog'").line)).toBe(true);
  });
});

describe("getReferences across multiple project entries", () => {
  async function multiEntryContext() {
    const ctx = createServerContext(new InMemoryFileSystem(multiEntryFiles()));
    await scanWorkspaceRootsForProjects(ctx, [MULTI_ROOT]);
    return ctx;
  }

  test("finds $ref locations across BOTH entry graphs, not just the first owning graph", async () => {
    const ctx = await multiEntryContext();
    const position = positionOf(SHARED_TEXT, "Pet:");

    const results = await getReferences(ctx, { path: SHARED_PATH, position, includeDeclaration: false });

    const files = results.map((r) => r.filePath).sort();
    expect(files).toEqual([ENTRY_A_PATH, ENTRY_B_PATH].sort());
  });

  test("includeDeclaration adds the shared definition site exactly once", async () => {
    const ctx = await multiEntryContext();
    const position = positionOf(SHARED_TEXT, "Pet:");

    const results = await getReferences(ctx, { path: SHARED_PATH, position, includeDeclaration: true });

    expect(results.filter((r) => r.filePath === SHARED_PATH)).toHaveLength(1);
    expect(results).toHaveLength(3);
  });
});
