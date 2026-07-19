import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "bun:test";
import { InMemoryFileSystem } from "@oasis/core";
import type { Range } from "@oasis/core";
import { prepareRename, renameComponent } from "../src/handlers/rename.ts";
import { OverlayFileSystem } from "../src/overlay-fs.ts";
import { scanWorkspaceRootsForProjects } from "../src/project.ts";
import { createServerContext } from "../src/workspace.ts";
import { positionOf } from "./helpers.ts";
import { ENTRY_PATH, ENTRY_TEXT, FRAGMENT_PATH, FRAGMENT_TEXT, ROOT, refsFixtureFiles } from "./refs-fixtures.ts";
import {
  ENTRY_A_PATH,
  ENTRY_A_TEXT,
  ENTRY_B_PATH,
  ENTRY_B_TEXT,
  ROOT as MULTI_ROOT,
  SHARED_PATH,
  SHARED_TEXT,
  multiEntryFiles,
} from "./multi-entry-fixtures.ts";

async function contextWithProject() {
  const ctx = createServerContext(new InMemoryFileSystem(refsFixtureFiles()));
  await scanWorkspaceRootsForProjects(ctx, [ROOT]);
  return ctx;
}

/** The exact substring a Range covers within `text` (single-line ranges only, which is all this
 * feature ever produces). */
function textAt(text: string, range: Range): string {
  const line = text.split("\n")[range.start.line];
  if (line === undefined || range.start.line !== range.end.line) {
    throw new Error(`unexpected multi-line or out-of-range: ${JSON.stringify(range)}`);
  }
  return line.slice(range.start.character, range.end.character);
}

describe("prepareRename", () => {
  test("valid on the definition key: range covers just the name, placeholder is the current name", async () => {
    const ctx = await contextWithProject();
    const position = positionOf(ENTRY_TEXT, "Pet:");

    const result = await prepareRename(ctx, { path: ENTRY_PATH, position });

    expect(result).toBeDefined();
    expect(result?.placeholder).toBe("Pet");
    expect(textAt(ENTRY_TEXT, result!.range)).toBe("Pet");
  });

  test("valid on a $ref value: range covers just the final pointer segment, not the whole ref string", async () => {
    const ctx = await contextWithProject();
    const position = positionOf(FRAGMENT_TEXT, "../openapi.yaml#/components/schemas/Pet");

    const result = await prepareRename(ctx, { path: FRAGMENT_PATH, position });

    expect(result).toBeDefined();
    expect(result?.placeholder).toBe("Pet");
    expect(textAt(FRAGMENT_TEXT, result!.range)).toBe("Pet");
  });

  test("invalid position returns undefined", async () => {
    const ctx = await contextWithProject();
    const position = positionOf(FRAGMENT_TEXT, "listPets");

    const result = await prepareRename(ctx, { path: FRAGMENT_PATH, position });

    expect(result).toBeUndefined();
  });
});

describe("renameComponent", () => {
  test("from the definition key: edits the key plus every referencing $ref across files", async () => {
    const ctx = await contextWithProject();
    const position = positionOf(ENTRY_TEXT, "Pet:");

    const edits = await renameComponent(ctx, { path: ENTRY_PATH, position, newName: "PetV2" });

    expect(edits).toBeDefined();
    expect(edits).toHaveLength(4);
    for (const edit of edits!) {
      expect(edit.newText).toBe("PetV2");
    }

    const byFile = new Map<string, typeof edits>();
    for (const edit of edits!) {
      byFile.set(edit.filePath, [...(byFile.get(edit.filePath) ?? []), edit]);
    }
    expect(byFile.get(ENTRY_PATH)).toHaveLength(2);
    expect(byFile.get(FRAGMENT_PATH)).toHaveLength(2);

    for (const edit of byFile.get(ENTRY_PATH)!) {
      expect(textAt(ENTRY_TEXT, edit.range)).toBe("Pet");
    }
    for (const edit of byFile.get(FRAGMENT_PATH)!) {
      expect(textAt(FRAGMENT_TEXT, edit.range)).toBe("Pet");
    }
  });

  test("from a $ref: produces the same edit set as renaming from the definition", async () => {
    const ctx = await contextWithProject();
    const position = positionOf(FRAGMENT_TEXT, "../openapi.yaml#/components/schemas/Pet");

    const edits = await renameComponent(ctx, { path: FRAGMENT_PATH, position, newName: "PetV2" });

    expect(edits).toBeDefined();
    expect(edits).toHaveLength(4);
    const byFile = edits!.reduce<Record<string, number>>((acc, e) => {
      acc[e.filePath] = (acc[e.filePath] ?? 0) + 1;
      return acc;
    }, {});
    expect(byFile[ENTRY_PATH]).toBe(2);
    expect(byFile[FRAGMENT_PATH]).toBe(2);
  });

  test("cross-file ref edit ranges cover only the final pointer segment of './x.yaml#/...' refs", async () => {
    const ctx = await contextWithProject();
    const position = positionOf(ENTRY_TEXT, "Pet:");

    const edits = await renameComponent(ctx, { path: ENTRY_PATH, position, newName: "PetV2" });

    const fragmentEdits = edits!.filter((e) => e.filePath === FRAGMENT_PATH);
    expect(fragmentEdits).toHaveLength(2);
    for (const edit of fragmentEdits) {
      const line = FRAGMENT_TEXT.split("\n")[edit.range.start.line]!;
      expect(line).toContain("../openapi.yaml#/components/schemas/Pet");
      expect(textAt(FRAGMENT_TEXT, edit.range)).toBe("Pet");
    }
  });

  test("rejects a name that collides with an existing component in the same section", async () => {
    const ctx = await contextWithProject();
    const position = positionOf(ENTRY_TEXT, "Pet:");

    const edits = await renameComponent(ctx, { path: ENTRY_PATH, position, newName: "Owner" });

    expect(edits).toBeUndefined();
  });

  test.each([
    ["empty", ""],
    ["slash", "Pet/2"],
    ["hash", "Pet#x"],
    ["tilde", "Pet~1"],
    ["space", "bad name"],
    ["colon", "bad:name"],
    ["double quote", 'bad"name'],
    ["single quote", "bad'name"],
    ["unicode", "Pété"],
    ["leading @", "@Pet"],
  ])("rejects an invalid new name (%s)", async (_label, newName) => {
    const ctx = await contextWithProject();
    const position = positionOf(ENTRY_TEXT, "Pet:");

    const edits = await renameComponent(ctx, { path: ENTRY_PATH, position, newName });

    expect(edits).toBeUndefined();
  });

  test.each(["Pet.V2", "Pet-2", "Pet_2"])("accepts a valid new name in the component grammar: %p", async (newName) => {
    const ctx = await contextWithProject();
    const position = positionOf(ENTRY_TEXT, "Pet:");

    const edits = await renameComponent(ctx, { path: ENTRY_PATH, position, newName });

    expect(edits).toBeDefined();
    for (const edit of edits!) expect(edit.newText).toBe(newName);
  });

  test("YAML: a valid-but-YAML-ambiguous new name (all digits) is single-quoted at the definition key, bare inside $refs", async () => {
    const ctx = await contextWithProject();
    const position = positionOf(ENTRY_TEXT, "Pet:");

    const edits = await renameComponent(ctx, { path: ENTRY_PATH, position, newName: "123" });

    expect(edits).toBeDefined();
    const keyEdit = edits!.find((e) => e.filePath === ENTRY_PATH && textAt(ENTRY_TEXT, e.range) === "Pet")!;
    // The definition key would be reparsed as an integer if written bare, so it's single-quoted.
    expect(keyEdit.newText).toBe("'123'");
    // The pointer segment inside a `$ref` string stays bare — it's already inside a string literal.
    for (const e of edits!.filter((e) => e.filePath === FRAGMENT_PATH)) expect(e.newText).toBe("123");
  });

  test("renaming to the same name is a valid no-op (not treated as a collision with itself)", async () => {
    const ctx = await contextWithProject();
    const position = positionOf(ENTRY_TEXT, "Pet:");

    const edits = await renameComponent(ctx, { path: ENTRY_PATH, position, newName: "Pet" });

    expect(edits).toBeDefined();
    expect(edits).toHaveLength(4);
  });
});

describe("renameComponent in a JSON document", () => {
  const JSON_PATH = "/repo/openapi.json";
  const JSON_TEXT = JSON.stringify(
    {
      openapi: "3.1.0",
      info: { title: "Test", version: "1.0.0" },
      components: {
        schemas: {
          Pet: { type: "object" },
          Owner: { type: "object", properties: { pet: { $ref: "#/components/schemas/Pet" } } },
        },
      },
    },
    null,
    2,
  );

  function applyEdits(text: string, edits: { range: Range; newText: string }[]): string {
    const sorted = [...edits].sort((a, b) => b.range.startOffset - a.range.startOffset);
    let out = text;
    for (const e of sorted) out = out.slice(0, e.range.startOffset) + e.newText + out.slice(e.range.endOffset);
    return out;
  }

  test("definition key is re-quoted as a JSON string; $ref segment is replaced bare; result is valid JSON", async () => {
    const ctx = createServerContext(new InMemoryFileSystem({ [JSON_PATH]: JSON_TEXT }));
    const position = positionOf(JSON_TEXT, '"Pet"');

    const edits = await renameComponent(ctx, { path: JSON_PATH, position, newName: "PetV2" });

    expect(edits).toBeDefined();
    const keyEdit = edits!.find((e) => JSON_TEXT.slice(e.range.startOffset, e.range.endOffset) === '"Pet"')!;
    expect(keyEdit.newText).toBe('"PetV2"');
    const refEdit = edits!.find((e) => JSON_TEXT.slice(e.range.startOffset, e.range.endOffset) === "Pet")!;
    expect(refEdit.newText).toBe("PetV2");

    const updated = applyEdits(JSON_TEXT, edits!.map((e) => ({ range: e.range, newText: e.newText })));
    const parsed = JSON.parse(updated);
    expect(parsed.components.schemas.PetV2).toBeDefined();
    expect(parsed.components.schemas.Pet).toBeUndefined();
    expect(parsed.components.schemas.Owner.properties.pet.$ref).toBe("#/components/schemas/PetV2");
  });
});

describe("renameComponent with nested component-pointer references (#55)", () => {
  const ENTRY = "/nested/openapi.yaml";
  const FRAG = "/nested/frag.yaml";
  const ENTRY_NESTED_TEXT = `openapi: 3.1.0
info:
  title: Test
  version: "1.0.0"
paths:
  /pets:
    $ref: './frag.yaml'
components:
  schemas:
    Pet:
      type: object
      properties:
        id:
          type: string
    PetId:
      $ref: '#/components/schemas/Pet/properties/id'
`;
  const FRAG_NESTED_TEXT = `get:
  operationId: listPets
  responses:
    '200':
      description: OK
      content:
        application/json:
          schema:
            $ref: '../nested/openapi.yaml#/components/schemas/Pet/properties/id'
`;

  function ctx() {
    return createServerContext(new InMemoryFileSystem({ [ENTRY]: ENTRY_NESTED_TEXT, [FRAG]: FRAG_NESTED_TEXT }));
  }

  test("rename edits only the component-name segment of nested-pointer refs, preserving the suffix", async () => {
    const edits = await renameComponent(ctx(), { path: ENTRY, position: positionOf(ENTRY_NESTED_TEXT, "Pet:"), newName: "Animal" });

    expect(edits).toBeDefined();
    // Definition key + local nested ref + external nested ref.
    expect(edits).toHaveLength(3);
    for (const edit of edits!) expect(edit.newText).toBe("Animal");

    const localNested = edits!.find((e) => e.filePath === ENTRY && e.range.start.line === positionOf(ENTRY_NESTED_TEXT, "#/components/schemas/Pet/properties/id").line)!;
    expect(textAt(ENTRY_NESTED_TEXT, localNested.range)).toBe("Pet");
    const line = ENTRY_NESTED_TEXT.split("\n")[localNested.range.start.line]!;
    // The suffix after the name segment is untouched.
    expect(line.slice(localNested.range.end.character)).toContain("/properties/id");

    const external = edits!.find((e) => e.filePath === FRAG)!;
    expect(textAt(FRAG_NESTED_TEXT, external.range)).toBe("Pet");
    const fragLine = FRAG_NESTED_TEXT.split("\n")[external.range.start.line]!;
    expect(fragLine.slice(external.range.end.character)).toContain("/properties/id");
  });

  test("a name that prefixes another component name does not match its refs", async () => {
    // `Pet` must not capture the `PetId` definition key or unrelated names starting with "Pet".
    const edits = await renameComponent(ctx(), { path: ENTRY, position: positionOf(ENTRY_NESTED_TEXT, "Pet:"), newName: "Animal" });
    const petIdKeyLine = positionOf(ENTRY_NESTED_TEXT, "PetId:").line;
    expect(edits!.some((e) => e.filePath === ENTRY && e.range.start.line === petIdKeyLine)).toBe(false);
  });

  test("escaped component names in refs: nested pointer under a name with pointer-escaped characters", async () => {
    const path = "/esc/openapi.yaml";
    const text = `openapi: 3.1.0
info:
  title: Test
  version: "1.0.0"
paths: {}
components:
  schemas:
    Pet.Tag:
      type: object
      properties:
        id:
          type: string
    Alias:
      $ref: '#/components/schemas/Pet.Tag/properties/id'
`;
    const c = createServerContext(new InMemoryFileSystem({ [path]: text }));
    const edits = await renameComponent(c, { path, position: positionOf(text, "Pet.Tag:"), newName: "PetTag" });

    expect(edits).toBeDefined();
    expect(edits).toHaveLength(2);
    for (const edit of edits!) {
      expect(edit.newText).toBe("PetTag");
      expect(textAt(text, edit.range)).toBe("Pet.Tag");
    }
  });
});

describe("renameComponent with name-based references (#54)", () => {
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
        - Other: []
      responses:
        '200':
          description: OK
components:
  securitySchemes:
    ApiKey:
      type: apiKey
      name: X-API-Key
      in: header
    Other:
      type: http
      scheme: basic
  schemas:
    Animal:
      type: object
      discriminator:
        propertyName: kind
        mapping:
          dog: Dog
          cat: '#/components/schemas/Cat'
      oneOf:
        - $ref: '#/components/schemas/Dog'
        - $ref: '#/components/schemas/Cat'
    Dog:
      type: object
    Cat:
      type: object
`;

  function ctx() {
    return createServerContext(new InMemoryFileSystem({ [PATH]: TEXT }));
  }

  test("renaming a security scheme rewrites root and operation Security Requirement keys", async () => {
    const edits = await renameComponent(ctx(), { path: PATH, position: positionOf(TEXT, "ApiKey:", 1), newName: "ApiKeyV2" });

    expect(edits).toBeDefined();
    // Definition key + root security requirement + operation security requirement.
    expect(edits).toHaveLength(3);
    for (const edit of edits!) {
      expect(edit.newText).toBe("ApiKeyV2");
      expect(textAt(TEXT, edit.range)).toBe("ApiKey");
    }
    const lines = new Set(edits!.map((e) => e.range.start.line));
    expect(lines.has(positionOf(TEXT, "- ApiKey: []").line)).toBe(true);
    expect(lines.has(positionOf(TEXT, "- ApiKey: []", 1).line)).toBe(true);
  });

  test("renaming a scheme used by one operation-level requirement edits the key and that requirement", async () => {
    const edits = await renameComponent(ctx(), { path: PATH, position: positionOf(TEXT, "Other:", 1), newName: "Basic" });
    expect(edits).toBeDefined();
    expect(edits).toHaveLength(2); // definition key + the one operation-level requirement
  });

  test("renaming a schema rewrites a bare discriminator mapping name, preserving the bare form", async () => {
    const edits = await renameComponent(ctx(), { path: PATH, position: positionOf(TEXT, "Dog:"), newName: "Hound" });

    expect(edits).toBeDefined();
    // Definition key + bare mapping value + $ref in oneOf.
    expect(edits).toHaveLength(3);
    const mappingLine = positionOf(TEXT, "dog: Dog").line;
    const mappingEdit = edits!.find((e) => e.range.start.line === mappingLine)!;
    expect(mappingEdit).toBeDefined();
    // Bare-name form is preserved: the replacement is the bare name, not a URI/pointer.
    expect(mappingEdit.newText).toBe("Hound");
    expect(textAt(TEXT, mappingEdit.range)).toBe("Dog");
  });

  test("renaming a schema referenced via a URI-style discriminator mapping edits the pointer segment only", async () => {
    const edits = await renameComponent(ctx(), { path: PATH, position: positionOf(TEXT, "Cat:"), newName: "Feline" });

    expect(edits).toBeDefined();
    // Definition key + URI-style mapping value + $ref in oneOf.
    expect(edits).toHaveLength(3);
    const mappingLine = positionOf(TEXT, "cat: '#/components/schemas/Cat'").line;
    const mappingEdit = edits!.find((e) => e.range.start.line === mappingLine)!;
    expect(mappingEdit.newText).toBe("Feline");
    expect(textAt(TEXT, mappingEdit.range)).toBe("Cat");
    // The URI-reference form is preserved (only the name segment is replaced).
    const line = TEXT.split("\n")[mappingLine]!;
    expect(line.slice(0, mappingEdit.range.start.character)).toContain("#/components/schemas/");
  });

  test("prepareRename works from a Security Requirement key context via the definition", async () => {
    const result = await prepareRename(ctx(), { path: PATH, position: positionOf(TEXT, "ApiKey:", 1) });
    expect(result).toBeDefined();
    expect(result?.placeholder).toBe("ApiKey");
  });
});

describe("prepareRename/renameComponent ignore ref-like strings in literal example data (#182)", () => {
  const PATH = "/repro/openapi.yaml";
  // The exact repro from the issue: an `example` value that merely looks like a `$ref`.
  const TEXT = `openapi: 3.1.0
info: { title: Repro, version: 1.0.0 }
paths: {}
components:
  schemas:
    Foo: { type: string }
    Holder:
      type: string
      example: '#/components/schemas/Foo'
`;

  function ctx() {
    return createServerContext(new InMemoryFileSystem({ [PATH]: TEXT }));
  }

  // The cursor sits inside `Holder`'s own subtree (its `example` value), so `resolveComponentTarget`
  // still resolves it as "cursor inside the Holder definition" — the pre-existing, intentional
  // fallback for renaming a component from anywhere within its body (independent of this bug). What
  // must NOT happen is treating the example string's text as a `$ref`-like pointer to `Foo`.
  test("prepareRename on the example string targets the enclosing Holder component, never Foo", async () => {
    const result = await prepareRename(ctx(), { path: PATH, position: positionOf(TEXT, "Foo", 1) });
    expect(result).toBeDefined();
    expect(result?.placeholder).toBe("Holder");
  });

  test("renameComponent from the example string only renames Holder, and never rewrites the example text or Foo's definition", async () => {
    const edits = await renameComponent(ctx(), { path: PATH, position: positionOf(TEXT, "Foo", 1), newName: "Bar" });
    expect(edits).toBeDefined();
    expect(edits).toHaveLength(1);
    // The single edit is Holder's own definition key, not Foo's, and the example string is untouched.
    expect(textAt(TEXT, edits![0]!.range)).toBe("Holder");
    const exampleLine = positionOf(TEXT, "example:").line;
    expect(edits!.some((e) => e.range.start.line === exampleLine)).toBe(false);
  });

  // A ref-like literal outside any component's own subtree (in a Path Item's response example) has
  // no enclosing-component fallback to fall back to, so this isolates the fix: it must resolve to
  // nothing at all, not to the `Foo` component the text merely resembles a pointer to.
  test("prepareRename on a ref-like literal outside any component subtree returns undefined", async () => {
    const path = "/repro2/openapi.yaml";
    const text = `openapi: 3.1.0
info: { title: Repro, version: 1.0.0 }
paths:
  /pets:
    get:
      operationId: listPets
      responses:
        '200':
          description: OK
          content:
            application/json:
              example: '#/components/schemas/Foo'
components:
  schemas:
    Foo: { type: string }
`;
    const c = createServerContext(new InMemoryFileSystem({ [path]: text }));
    const result = await prepareRename(c, { path, position: positionOf(text, "#/components/schemas/Foo") });
    expect(result).toBeUndefined();
  });
});

describe("renameComponent ignores lookalikes in literal data contexts (#118)", () => {
  const PATH = "/ctx/openapi.yaml";
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

  function ctx() {
    return createServerContext(new InMemoryFileSystem({ [PATH]: TEXT }));
  }

  /** Line numbers of the literal-data `- Auth: []` copies (example, default, enum, x-vendor). */
  function payloadAuthLines(): Set<number> {
    return new Set([2, 3, 4, 5].map((i) => positionOf(TEXT, "- Auth: []", i).line));
  }

  test("renaming a security scheme edits only genuine Security Requirement keys, leaving payloads untouched", async () => {
    const edits = await renameComponent(ctx(), { path: PATH, position: positionOf(TEXT, "Auth:", 6), newName: "AuthV2" });

    expect(edits).toBeDefined();
    // Definition key + root requirement + operation requirement — nothing under example/default/enum/x-*.
    expect(edits).toHaveLength(3);
    for (const edit of edits!) {
      expect(edit.newText).toBe("AuthV2");
      expect(textAt(TEXT, edit.range)).toBe("Auth");
    }
    const editLines = new Set(edits!.map((e) => e.range.start.line));
    for (const payloadLine of payloadAuthLines()) expect(editLines.has(payloadLine)).toBe(false);
    expect(editLines.has(positionOf(TEXT, "- Auth: []").line)).toBe(true);
    expect(editLines.has(positionOf(TEXT, "- Auth: []", 1).line)).toBe(true);
  });

  test("renaming a schema edits only the genuine discriminator mapping, leaving payloads untouched", async () => {
    const edits = await renameComponent(ctx(), { path: PATH, position: positionOf(TEXT, "Dog:"), newName: "Hound" });

    expect(edits).toBeDefined();
    // Definition key + genuine discriminator mapping + $ref — never the example/const copies.
    expect(edits).toHaveLength(3);
    const editLines = new Set(edits!.map((e) => e.range.start.line));
    // The example and const copies of "dog: Dog" (occurrences 0 and 2) must not be edited.
    expect(editLines.has(positionOf(TEXT, "dog: Dog", 0).line)).toBe(false);
    expect(editLines.has(positionOf(TEXT, "dog: Dog", 2).line)).toBe(false);
    expect(editLines.has(positionOf(TEXT, "dog: Dog", 1).line)).toBe(true);
  });
});

describe("renameComponent with unsaved overlay content", () => {
  const dir = mkdtempSync(join(tmpdir(), "oasis-rename-overlay-"));
  const entryPath = join(dir, "openapi.yaml");

  // Disk content: no `$ref` to Pet at all, and Pet defined one line higher than in the overlay.
  const diskText = `openapi: 3.1.0
info:
  title: Test
  version: "1.0.0"
paths: {}
components:
  schemas:
    Pet:
      type: object
`;

  // Unsaved buffer: adds an operation with a $ref to Pet, shifting Pet's definition further down.
  // Only present in the overlay, never written to disk.
  const overlayText = `openapi: 3.1.0
info:
  title: Test
  version: "1.0.0"
paths:
  /pets:
    get:
      operationId: listPets
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Pet'
components:
  schemas:
    Pet:
      type: object
`;

  writeFileSync(entryPath, diskText, "utf-8");

  afterAll(() => {
    // Best-effort cleanup; not load-bearing for the test result.
  });

  test("resolves positions and produces edits against the unsaved buffer, not disk content", async () => {
    const fs = new OverlayFileSystem((path) => (path === entryPath ? overlayText : undefined));
    const ctx = createServerContext(fs);

    const position = positionOf(overlayText, "#/components/schemas/Pet");
    const edits = await renameComponent(ctx, { path: entryPath, position, newName: "PetV2" });

    expect(edits).toBeDefined();
    expect(edits).toHaveLength(2);
    for (const edit of edits!) {
      expect(edit.filePath).toBe(entryPath);
      expect(edit.newText).toBe("PetV2");
      expect(textAt(overlayText, edit.range)).toBe("Pet");
    }
  });
});

describe("renameComponent across multiple project entries", () => {
  async function multiEntryContext() {
    const ctx = createServerContext(new InMemoryFileSystem(multiEntryFiles()));
    await scanWorkspaceRootsForProjects(ctx, [MULTI_ROOT]);
    return ctx;
  }

  test("a component in a file $ref'd by two entries: rename rewrites the $ref in BOTH entry docs", async () => {
    const ctx = await multiEntryContext();
    const position = positionOf(SHARED_TEXT, "Pet:");

    const edits = await renameComponent(ctx, { path: SHARED_PATH, position, newName: "PetV2" });

    expect(edits).toBeDefined();
    for (const edit of edits!) expect(edit.newText).toBe("PetV2");

    const files = new Set(edits!.map((e) => e.filePath));
    // The definition (shared.yaml) plus the referencing $ref in each of the two entries.
    expect(files).toEqual(new Set([SHARED_PATH, ENTRY_A_PATH, ENTRY_B_PATH]));
    expect(edits!.filter((e) => e.filePath === ENTRY_A_PATH)).toHaveLength(1);
    expect(edits!.filter((e) => e.filePath === ENTRY_B_PATH)).toHaveLength(1);
    // The shared file, reachable from both graphs, is still edited exactly once (deduped).
    expect(edits!.filter((e) => e.filePath === SHARED_PATH)).toHaveLength(1);

    expect(textAt(ENTRY_A_TEXT, edits!.find((e) => e.filePath === ENTRY_A_PATH)!.range)).toBe("Pet");
    expect(textAt(ENTRY_B_TEXT, edits!.find((e) => e.filePath === ENTRY_B_PATH)!.range)).toBe("Pet");
  });
});
