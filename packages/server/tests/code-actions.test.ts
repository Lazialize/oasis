import { describe, expect, test } from "bun:test";
import { InMemoryFileSystem } from "@oasis/core";
import { getCodeActions } from "../src/handlers/code-actions.ts";
import type { CodeActionFileEdit } from "../src/handlers/code-actions.ts";
import { getDiagnosticsByFile } from "../src/diagnostics.ts";
import { scanWorkspaceRootsForProjects } from "../src/project.ts";
import { createServerContext } from "../src/workspace.ts";
import type { ServerContext } from "../src/workspace.ts";
import { positionOf } from "./helpers.ts";

/** Apply a set of edits (assumed to all target the same file) to `text`, latest-offset-first so
 * earlier offsets stay valid as we go. */
function applyEdits(text: string, edits: CodeActionFileEdit[]): string {
  const sorted = [...edits].sort((a, b) => b.range.startOffset - a.range.startOffset);
  let out = text;
  for (const e of sorted) out = out.slice(0, e.range.startOffset) + e.newText + out.slice(e.range.endOffset);
  return out;
}

async function diagnosticsFor(ctx: ServerContext, entryPath: string) {
  const byFile = await getDiagnosticsByFile(ctx, entryPath);
  return byFile;
}

describe("Add operationId", () => {
  const ENTRY_PATH = "/repo/openapi.yaml";
  const TEXT = `openapi: 3.1.0
info:
  title: Test API
  version: "1.0.0"
paths:
  /pets:
    get:
      responses:
        '200':
          description: OK
    post:
      operationId: getPets
      description: A pre-existing id that collides with the generated one.
      responses:
        '201':
          description: Created
`;

  test("inserts operationId as the first key, generated from method + path, deduped against existing ids", async () => {
    const ctx = createServerContext(new InMemoryFileSystem({ [ENTRY_PATH]: TEXT }));
    const byFile = await diagnosticsFor(ctx, ENTRY_PATH);
    const diagnostics = byFile.get(ENTRY_PATH) ?? [];
    expect(diagnostics.some((d) => d.code === "operation-operationId")).toBe(true);

    const position = positionOf(TEXT, "get:");
    const results = await getCodeActions(ctx, { path: ENTRY_PATH, position, diagnostics });
    const action = results.find((r) => r.title === "Add operationId");
    expect(action).toBeDefined();
    expect(action?.isPreferred).toBe(true);
    expect(action?.kind).toBe("quickfix");
    expect(action?.edits).toHaveLength(1);

    const newText = applyEdits(TEXT, action!.edits);
    // "getPets" is already taken by the post operation -> deduped to "getPets2".
    expect(newText).toContain("get:\n      operationId: getPets2\n      responses:");

    const ctx2 = createServerContext(new InMemoryFileSystem({ [ENTRY_PATH]: newText }));
    const diags2 = (await diagnosticsFor(ctx2, ENTRY_PATH)).get(ENTRY_PATH) ?? [];
    expect(diags2.some((d) => d.code === "operation-operationId")).toBe(false);
    expect(diags2.some((d) => d.code === "syntax-error")).toBe(false);
  });

  test("no action for a stale diagnostic (operation already has an operationId)", async () => {
    const fixedText = TEXT.replace("get:\n      responses:", "get:\n      operationId: listPets\n      responses:");
    const ctx = createServerContext(new InMemoryFileSystem({ [ENTRY_PATH]: fixedText }));
    // Diagnostic computed against the *old* text/range, simulating a stale publish.
    const staleDiagnostics = (await diagnosticsFor(createServerContext(new InMemoryFileSystem({ [ENTRY_PATH]: TEXT })), ENTRY_PATH)).get(
      ENTRY_PATH,
    )!;

    const position = positionOf(fixedText, "get:");
    const results = await getCodeActions(ctx, { path: ENTRY_PATH, position, diagnostics: staleDiagnostics });
    expect(results.find((r) => r.title === "Add operationId")).toBeUndefined();
  });
});

describe("Add description", () => {
  const ENTRY_PATH = "/repo/openapi.yaml";
  const TEXT = `openapi: 3.1.0
info:
  title: Test API
  version: "1.0.0"
paths:
  /pets:
    get:
      operationId: listPets
      responses:
        '200':
          description: OK
`;

  test("inserts description: TODO as the first key", async () => {
    const ctx = createServerContext(new InMemoryFileSystem({ [ENTRY_PATH]: TEXT }));
    const diagnostics = (await diagnosticsFor(ctx, ENTRY_PATH)).get(ENTRY_PATH) ?? [];
    expect(diagnostics.some((d) => d.code === "operation-description")).toBe(true);

    const position = positionOf(TEXT, "get:");
    const results = await getCodeActions(ctx, { path: ENTRY_PATH, position, diagnostics });
    const action = results.find((r) => r.title === "Add description");
    expect(action).toBeDefined();
    expect(action?.isPreferred).toBe(true);

    const newText = applyEdits(TEXT, action!.edits);
    expect(newText).toContain("get:\n      description: TODO\n      operationId: listPets");

    const diags2 = (await diagnosticsFor(createServerContext(new InMemoryFileSystem({ [ENTRY_PATH]: newText })), ENTRY_PATH)).get(ENTRY_PATH) ?? [];
    expect(diags2.some((d) => d.code === "operation-description")).toBe(false);
    expect(diags2.some((d) => d.code === "syntax-error")).toBe(false);
  });
});

describe("Add parameter definition", () => {
  const ENTRY_PATH = "/repo/openapi.yaml";
  const TEXT = `openapi: 3.1.0
info:
  title: Test API
  version: "1.0.0"
paths:
  /pets/{petId}:
    get:
      operationId: getPet
      description: Get a pet.
      responses:
        '200':
          description: OK
    post:
      operationId: createPet
      description: Create a pet.
      parameters:
        - name: petId
          in: path
          required: true
          schema:
            type: string
      responses:
        '201':
          description: Created
  /widgets/{widgetId}:
    parameters:
      - name: verbose
        in: query
        schema:
          type: boolean
    get:
      operationId: getWidget
      description: Get a widget.
      responses:
        '200':
          description: OK
components:
  schemas:
    Unused:
      type: object
      description: never referenced
`;

  test("YAML path item without an existing parameters list: creates one", async () => {
    const ctx = createServerContext(new InMemoryFileSystem({ [ENTRY_PATH]: TEXT }));
    const diagnostics = (await diagnosticsFor(ctx, ENTRY_PATH)).get(ENTRY_PATH) ?? [];
    const missingPetId = diagnostics.filter(
      (d) => d.code === "path-params-defined" && d.message.includes('parameter "{petId}" has no matching'),
    );
    expect(missingPetId.length).toBeGreaterThan(0);

    const position = positionOf(TEXT, "/pets/{petId}:");
    const results = await getCodeActions(ctx, { path: ENTRY_PATH, position, diagnostics });
    const action = results.find(
      (r) => r.title === "Add parameter definition" && diagnostics[r.diagnosticIndex!]?.message.includes("petId"),
    );
    expect(action).toBeDefined();
    expect(action?.isPreferred).toBe(true);

    const newText = applyEdits(TEXT, action!.edits);
    expect(newText).toContain(
      "  /pets/{petId}:\n    parameters:\n      - name: petId\n        in: path\n        required: true\n        schema:\n          type: string\n    get:",
    );

    const diags2 = (await diagnosticsFor(createServerContext(new InMemoryFileSystem({ [ENTRY_PATH]: newText })), ENTRY_PATH)).get(ENTRY_PATH) ?? [];
    expect(diags2.some((d) => d.code === "path-params-defined" && d.message.includes('"{petId}"'))).toBe(false);
    expect(diags2.some((d) => d.code === "syntax-error")).toBe(false);
  });

  test("YAML path item with an existing parameters list: appends to it", async () => {
    const ctx = createServerContext(new InMemoryFileSystem({ [ENTRY_PATH]: TEXT }));
    const diagnostics = (await diagnosticsFor(ctx, ENTRY_PATH)).get(ENTRY_PATH) ?? [];
    const missingWidgetId = diagnostics.filter(
      (d) => d.code === "path-params-defined" && d.message.includes('parameter "{widgetId}" has no matching'),
    );
    expect(missingWidgetId.length).toBeGreaterThan(0);

    const position = positionOf(TEXT, "/widgets/{widgetId}:");
    const results = await getCodeActions(ctx, { path: ENTRY_PATH, position, diagnostics });
    const action = results.find(
      (r) => r.title === "Add parameter definition" && diagnostics[r.diagnosticIndex!]?.message.includes("widgetId"),
    );
    expect(action).toBeDefined();

    const newText = applyEdits(TEXT, action!.edits);
    // The new item is appended after the existing "verbose" query parameter, same list.
    expect(newText).toContain(
      "type: boolean\n      - name: widgetId\n        in: path\n        required: true\n        schema:\n          type: string\n    get:",
    );

    const diags2 = (await diagnosticsFor(createServerContext(new InMemoryFileSystem({ [ENTRY_PATH]: newText })), ENTRY_PATH)).get(ENTRY_PATH) ?? [];
    expect(diags2.some((d) => d.code === "path-params-defined" && d.message.includes('"{widgetId}"'))).toBe(false);
    expect(diags2.some((d) => d.code === "syntax-error")).toBe(false);
  });
});

describe("Remove unused component", () => {
  const ENTRY_PATH = "/repo/openapi.yaml";
  const TEXT = `openapi: 3.1.0
info:
  title: Test API
  version: "1.0.0"
paths:
  /pets:
    get:
      operationId: listPets
      description: List pets.
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
      properties:
        id:
          type: string
        kept:
          $ref: '#/components/schemas/AlsoKept'
    Unused:
      type: object
      description: never referenced
    AlsoKept:
      type: string
`;

  test("deletes the unused component's key+value, leaving neighbors intact", async () => {
    const ctx = createServerContext(new InMemoryFileSystem({ [ENTRY_PATH]: TEXT }));
    const diagnostics = (await diagnosticsFor(ctx, ENTRY_PATH)).get(ENTRY_PATH) ?? [];
    expect(diagnostics.some((d) => d.code === "no-unused-components")).toBe(true);

    const position = positionOf(TEXT, "Unused:");
    const results = await getCodeActions(ctx, { path: ENTRY_PATH, position, diagnostics });
    const action = results.find((r) => r.title === "Remove unused component");
    expect(action).toBeDefined();
    expect(action?.edits).toHaveLength(1);
    expect(action?.edits[0]?.newText).toBe("");

    const newText = applyEdits(TEXT, action!.edits);
    expect(newText).not.toContain("Unused:");
    expect(newText).not.toContain("never referenced");
    // Neighbors survive untouched.
    expect(newText).toContain("Pet:\n      type: object");
    expect(newText).toContain("AlsoKept:\n      type: string");

    const ctx2 = createServerContext(new InMemoryFileSystem({ [ENTRY_PATH]: newText }));
    const diags2 = (await diagnosticsFor(ctx2, ENTRY_PATH)).get(ENTRY_PATH) ?? [];
    expect(diags2.some((d) => d.code === "no-unused-components")).toBe(false);
    expect(diags2.some((d) => d.code === "syntax-error")).toBe(false);
    // Pet is still resolvable ($ref intact) and used.
    expect(diags2.some((d) => d.code === "no-unresolved-ref")).toBe(false);
  });
});

describe("Extract inline schema to components", () => {
  test("from the entry file, creating components/schemas from scratch", async () => {
    const ENTRY_PATH = "/repo/openapi.yaml";
    const TEXT = `openapi: 3.1.0
info:
  title: Test API
  version: "1.0.0"
paths:
  /pets:
    get:
      operationId: listPets
      description: List pets.
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                type: object
                properties:
                  id:
                    type: string
`;
    const ctx = createServerContext(new InMemoryFileSystem({ [ENTRY_PATH]: TEXT }));
    const position = positionOf(TEXT, "type: object\n                properties:");
    const results = await getCodeActions(ctx, { path: ENTRY_PATH, position, diagnostics: [] });
    const action = results.find((r) => r.title === "Extract inline schema to components");
    expect(action).toBeDefined();
    expect(action?.kind).toBe("refactor.extract");
    expect(action?.edits).toHaveLength(2);

    const newText = applyEdits(TEXT, action!.edits);
    expect(newText).toContain("$ref: '#/components/schemas/ListPetsResponse'");
    expect(newText).toContain("components:\n  schemas:\n    ListPetsResponse:\n      type: object\n      properties:\n        id:\n          type: string\n");

    const ctx2 = createServerContext(new InMemoryFileSystem({ [ENTRY_PATH]: newText }));
    const diags2 = (await diagnosticsFor(ctx2, ENTRY_PATH)).get(ENTRY_PATH) ?? [];
    expect(diags2.some((d) => d.code === "no-unresolved-ref")).toBe(false);
    expect(diags2.some((d) => d.code === "syntax-error")).toBe(false);
    expect(diags2.some((d) => d.code === "no-unused-components")).toBe(false);
  });

  test("from the entry file, appending into an existing components/schemas map", async () => {
    const ENTRY_PATH = "/repo/openapi.yaml";
    const TEXT = `openapi: 3.1.0
info:
  title: Test API
  version: "1.0.0"
paths:
  /pets:
    get:
      operationId: listPets
      description: List pets.
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                type: array
                items:
                  type: string
components:
  schemas:
    Pet:
      type: object
`;
    const ctx = createServerContext(new InMemoryFileSystem({ [ENTRY_PATH]: TEXT }));
    const position = positionOf(TEXT, "type: array");
    const results = await getCodeActions(ctx, { path: ENTRY_PATH, position, diagnostics: [] });
    const action = results.find((r) => r.title === "Extract inline schema to components");
    expect(action).toBeDefined();

    const newText = applyEdits(TEXT, action!.edits);
    expect(newText).toContain("$ref: '#/components/schemas/ListPetsResponse'");
    expect(newText).toContain("schemas:\n    ListPetsResponse:\n      type: array\n      items:\n        type: string\n    Pet:\n      type: object");

    const ctx2 = createServerContext(new InMemoryFileSystem({ [ENTRY_PATH]: newText }));
    const diags2 = (await diagnosticsFor(ctx2, ENTRY_PATH)).get(ENTRY_PATH) ?? [];
    expect(diags2.some((d) => d.code === "no-unresolved-ref")).toBe(false);
    expect(diags2.some((d) => d.code === "syntax-error")).toBe(false);
  });

  test("from a fragment file in project mode: ref points back to the entry file across files", async () => {
    const ROOT = "/proj";
    const CONFIG_PATH = `${ROOT}/oasis.config.jsonc`;
    const ENTRY_PATH = `${ROOT}/openapi.yaml`;
    const FRAGMENT_PATH = `${ROOT}/paths/pets.yaml`;

    const ENTRY_TEXT = `openapi: 3.1.0
info:
  title: Test API
  version: "1.0.0"
paths:
  /pets:
    $ref: './paths/pets.yaml'
`;
    const FRAGMENT_TEXT = `get:
  operationId: listPets
  description: List pets.
  responses:
    '200':
      description: OK
      content:
        application/json:
          schema:
            type: object
            properties:
              id:
                type: string
`;

    const ctx = createServerContext(
      new InMemoryFileSystem({
        [CONFIG_PATH]: `{ "entries": ["openapi.yaml"] }`,
        [ENTRY_PATH]: ENTRY_TEXT,
        [FRAGMENT_PATH]: FRAGMENT_TEXT,
      }),
    );
    await scanWorkspaceRootsForProjects(ctx, [ROOT]);

    const position = positionOf(FRAGMENT_TEXT, "type: object\n            properties:");
    const results = await getCodeActions(ctx, { path: FRAGMENT_PATH, position, diagnostics: [] });
    const action = results.find((r) => r.title === "Extract inline schema to components");
    expect(action).toBeDefined();
    expect(action?.edits).toHaveLength(2);

    const fragmentEdit = action!.edits.find((e) => e.filePath === FRAGMENT_PATH);
    const entryEdit = action!.edits.find((e) => e.filePath === ENTRY_PATH);
    expect(fragmentEdit).toBeDefined();
    expect(entryEdit).toBeDefined();

    const newFragmentText = applyEdits(FRAGMENT_TEXT, [fragmentEdit!]);
    const newEntryText = applyEdits(ENTRY_TEXT, [entryEdit!]);

    expect(newFragmentText).toContain("$ref: '../openapi.yaml#/components/schemas/ListPetsResponse'");
    expect(newEntryText).toContain("components:\n  schemas:\n    ListPetsResponse:\n      type: object\n      properties:\n        id:\n          type: string\n");

    const ctx2 = createServerContext(
      new InMemoryFileSystem({
        [CONFIG_PATH]: `{ "entries": ["openapi.yaml"] }`,
        [ENTRY_PATH]: newEntryText,
        [FRAGMENT_PATH]: newFragmentText,
      }),
    );
    const diags2 = (await diagnosticsFor(ctx2, ENTRY_PATH)).get(FRAGMENT_PATH) ?? [];
    expect(diags2.some((d) => d.code === "no-unresolved-ref")).toBe(false);
    expect(diags2.some((d) => d.code === "syntax-error")).toBe(false);
  });
});
