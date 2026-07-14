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
    expect(diagnostics.some((d) => d.code === "operation/operation-id")).toBe(true);

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
    expect(diags2.some((d) => d.code === "operation/operation-id")).toBe(false);
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
    expect(diagnostics.some((d) => d.code === "operation/description")).toBe(true);

    const position = positionOf(TEXT, "get:");
    const results = await getCodeActions(ctx, { path: ENTRY_PATH, position, diagnostics });
    const action = results.find((r) => r.title === "Add description");
    expect(action).toBeDefined();
    expect(action?.isPreferred).toBe(true);

    const newText = applyEdits(TEXT, action!.edits);
    expect(newText).toContain("get:\n      description: TODO\n      operationId: listPets");

    const diags2 = (await diagnosticsFor(createServerContext(new InMemoryFileSystem({ [ENTRY_PATH]: newText })), ENTRY_PATH)).get(ENTRY_PATH) ?? [];
    expect(diags2.some((d) => d.code === "operation/description")).toBe(false);
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
      (d) => d.code === "paths/params-defined" && d.message.includes('parameter "{petId}" has no matching'),
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
    expect(diags2.some((d) => d.code === "paths/params-defined" && d.message.includes('"{petId}"'))).toBe(false);
    expect(diags2.some((d) => d.code === "syntax-error")).toBe(false);
  });

  test("YAML path item with an existing parameters list: appends to it", async () => {
    const ctx = createServerContext(new InMemoryFileSystem({ [ENTRY_PATH]: TEXT }));
    const diagnostics = (await diagnosticsFor(ctx, ENTRY_PATH)).get(ENTRY_PATH) ?? [];
    const missingWidgetId = diagnostics.filter(
      (d) => d.code === "paths/params-defined" && d.message.includes('parameter "{widgetId}" has no matching'),
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
    expect(diags2.some((d) => d.code === "paths/params-defined" && d.message.includes('"{widgetId}"'))).toBe(false);
    expect(diags2.some((d) => d.code === "syntax-error")).toBe(false);
  });
});

describe("Add parameter definition into an inline empty sequence (parameters: [])", () => {
  const ENTRY_PATH = "/repo/openapi.yaml";

  test("path item with parameters: [] and an operation: replaces [] with a valid block sequence", async () => {
    const TEXT = `openapi: 3.1.0
info:
  title: Test API
  version: "1.0.0"
paths:
  /pets/{petId}:
    parameters: []
    get:
      operationId: getPet
      description: Get a pet.
      responses:
        '200':
          description: OK
`;
    const ctx = createServerContext(new InMemoryFileSystem({ [ENTRY_PATH]: TEXT }));
    const diagnostics = (await diagnosticsFor(ctx, ENTRY_PATH)).get(ENTRY_PATH) ?? [];
    expect(diagnostics.some((d) => d.code === "paths/params-defined" && d.message.includes('"{petId}"'))).toBe(true);

    const position = positionOf(TEXT, "/pets/{petId}:");
    const results = await getCodeActions(ctx, { path: ENTRY_PATH, position, diagnostics });
    const action = results.find((r) => r.title === "Add parameter definition");
    expect(action).toBeDefined();

    const newText = applyEdits(TEXT, action!.edits);
    expect(newText).toContain(
      "  /pets/{petId}:\n    parameters:\n      - name: petId\n        in: path\n        required: true\n        schema:\n          type: string\n    get:",
    );

    const diags2 = (await diagnosticsFor(createServerContext(new InMemoryFileSystem({ [ENTRY_PATH]: newText })), ENTRY_PATH)).get(ENTRY_PATH) ?? [];
    expect(diags2.some((d) => d.code === "syntax-error")).toBe(false);
    expect(diags2.some((d) => d.code === "paths/params-defined" && d.message.includes('"{petId}"'))).toBe(false);
  });

  test("path item with parameters: [] and no operation: replaces [] with a valid block sequence, preserving a trailing comment", async () => {
    const TEXT = `openapi: 3.1.0
info:
  title: Test API
  version: "1.0.0"
paths:
  /pets/{petId}:
    parameters: [] # none yet
`;
    const ctx = createServerContext(new InMemoryFileSystem({ [ENTRY_PATH]: TEXT }));
    const diagnostics = (await diagnosticsFor(ctx, ENTRY_PATH)).get(ENTRY_PATH) ?? [];
    expect(diagnostics.some((d) => d.code === "paths/params-defined" && d.message.includes('"{petId}"'))).toBe(true);

    const position = positionOf(TEXT, "/pets/{petId}:");
    const results = await getCodeActions(ctx, { path: ENTRY_PATH, position, diagnostics });
    const action = results.find((r) => r.title === "Add parameter definition");
    expect(action).toBeDefined();

    const newText = applyEdits(TEXT, action!.edits);
    expect(newText).toContain("    parameters:\n      - name: petId\n        in: path\n        required: true");

    const diags2 = (await diagnosticsFor(createServerContext(new InMemoryFileSystem({ [ENTRY_PATH]: newText })), ENTRY_PATH)).get(ENTRY_PATH) ?? [];
    expect(diags2.some((d) => d.code === "syntax-error")).toBe(false);
    expect(diags2.some((d) => d.code === "paths/params-defined" && d.message.includes('"{petId}"'))).toBe(false);
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
    expect(diagnostics.some((d) => d.code === "components/no-unused")).toBe(true);

    const position = positionOf(TEXT, "Unused:");
    const results = await getCodeActions(ctx, { path: ENTRY_PATH, position, diagnostics });
    const action = results.find((r) => r.title === "Remove unused component 'Unused'");
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
    expect(diags2.some((d) => d.code === "components/no-unused")).toBe(false);
    expect(diags2.some((d) => d.code === "syntax-error")).toBe(false);
    // Pet is still resolvable ($ref intact) and used.
    expect(diags2.some((d) => d.code === "refs/no-unresolved")).toBe(false);
  });

  test("removing the last entry of a section also removes the now-empty section key", async () => {
    const TEXT = `openapi: 3.1.0
info:
  title: Test API
  version: "1.0.0"
paths:
  /pets:
    get:
      operationId: listPets
      description: List pets.
      parameters:
        - $ref: '#/components/parameters/Limit'
      responses:
        '200':
          description: OK
components:
  parameters:
    Limit:
      name: limit
      in: query
      schema:
        type: integer
  schemas:
    Unused:
      type: object
      description: never referenced
`;
    const ctx = createServerContext(new InMemoryFileSystem({ [ENTRY_PATH]: TEXT }));
    const diagnostics = (await diagnosticsFor(ctx, ENTRY_PATH)).get(ENTRY_PATH) ?? [];
    expect(diagnostics.some((d) => d.code === "components/no-unused")).toBe(true);

    const position = positionOf(TEXT, "Unused:");
    const results = await getCodeActions(ctx, { path: ENTRY_PATH, position, diagnostics });
    const action = results.find((r) => r.title === "Remove unused component 'Unused'");
    expect(action).toBeDefined();
    expect(action?.edits).toHaveLength(1);

    const newText = applyEdits(TEXT, action!.edits);
    expect(newText).not.toContain("Unused:");
    expect(newText).not.toContain("schemas:");
    // The sibling section and `components:` itself survive.
    expect(newText).toContain("components:\n  parameters:\n    Limit:");

    const ctx2 = createServerContext(new InMemoryFileSystem({ [ENTRY_PATH]: newText }));
    const diags2 = (await diagnosticsFor(ctx2, ENTRY_PATH)).get(ENTRY_PATH) ?? [];
    expect(diags2.some((d) => d.code === "components/no-unused")).toBe(false);
    expect(diags2.some((d) => d.code === "syntax-error")).toBe(false);
  });

  test("removing the last component overall also removes the now-empty `components:` key", async () => {
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
components:
  schemas:
    Unused:
      type: object
      description: never referenced
`;
    const ctx = createServerContext(new InMemoryFileSystem({ [ENTRY_PATH]: TEXT }));
    const diagnostics = (await diagnosticsFor(ctx, ENTRY_PATH)).get(ENTRY_PATH) ?? [];
    expect(diagnostics.some((d) => d.code === "components/no-unused")).toBe(true);

    const position = positionOf(TEXT, "Unused:");
    const results = await getCodeActions(ctx, { path: ENTRY_PATH, position, diagnostics });
    const action = results.find((r) => r.title === "Remove unused component 'Unused'");
    expect(action).toBeDefined();

    const newText = applyEdits(TEXT, action!.edits);
    expect(newText).not.toContain("Unused:");
    expect(newText).not.toContain("components:");
    expect(newText).not.toContain("schemas:");

    const ctx2 = createServerContext(new InMemoryFileSystem({ [ENTRY_PATH]: newText }));
    const diags2 = (await diagnosticsFor(ctx2, ENTRY_PATH)).get(ENTRY_PATH) ?? [];
    expect(diags2.some((d) => d.code === "components/no-unused")).toBe(false);
    expect(diags2.some((d) => d.code === "syntax-error")).toBe(false);
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
    expect(diags2.some((d) => d.code === "refs/no-unresolved")).toBe(false);
    expect(diags2.some((d) => d.code === "syntax-error")).toBe(false);
    expect(diags2.some((d) => d.code === "components/no-unused")).toBe(false);
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
    expect(diags2.some((d) => d.code === "refs/no-unresolved")).toBe(false);
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
    expect(diags2.some((d) => d.code === "refs/no-unresolved")).toBe(false);
    expect(diags2.some((d) => d.code === "syntax-error")).toBe(false);
  });

  test("cross-file extract rebases the schema's file-relative refs for the entry document (#56)", async () => {
    const ROOT = "/projx";
    const CONFIG_PATH = `${ROOT}/oasis.config.jsonc`;
    const ENTRY_PATH = `${ROOT}/openapi.yaml`;
    const FRAGMENT_PATH = `${ROOT}/paths/pets.yaml`;
    const SHARED_PATH = `${ROOT}/paths/shared.yaml`;

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
              item:
                $ref: './shared.yaml#/Item'
`;
    const SHARED_TEXT = `Item:
  type: string
`;

    const ctx = createServerContext(
      new InMemoryFileSystem({
        [CONFIG_PATH]: `{ "entries": ["openapi.yaml"] }`,
        [ENTRY_PATH]: ENTRY_TEXT,
        [FRAGMENT_PATH]: FRAGMENT_TEXT,
        [SHARED_PATH]: SHARED_TEXT,
      }),
    );
    await scanWorkspaceRootsForProjects(ctx, [ROOT]);

    const position = positionOf(FRAGMENT_TEXT, "type: object\n            properties:");
    const results = await getCodeActions(ctx, { path: FRAGMENT_PATH, position, diagnostics: [] });
    const action = results.find((r) => r.title === "Extract inline schema to components");
    expect(action).toBeDefined();

    const fragmentEdit = action!.edits.find((e) => e.filePath === FRAGMENT_PATH)!;
    const entryEdit = action!.edits.find((e) => e.filePath === ENTRY_PATH)!;
    const newFragmentText = applyEdits(FRAGMENT_TEXT, [fragmentEdit]);
    const newEntryText = applyEdits(ENTRY_TEXT, [entryEdit]);

    // './shared.yaml' was relative to paths/; from the entry document it must be './paths/shared.yaml'.
    expect(newEntryText).toContain("$ref: './paths/shared.yaml#/Item'");
    expect(newEntryText).not.toContain("'./shared.yaml#/Item'");

    const ctx2 = createServerContext(
      new InMemoryFileSystem({
        [CONFIG_PATH]: `{ "entries": ["openapi.yaml"] }`,
        [ENTRY_PATH]: newEntryText,
        [FRAGMENT_PATH]: newFragmentText,
        [SHARED_PATH]: SHARED_TEXT,
      }),
    );
    await scanWorkspaceRootsForProjects(ctx2, [ROOT]);
    const entryDiags = (await diagnosticsFor(ctx2, ENTRY_PATH)).get(ENTRY_PATH) ?? [];
    expect(entryDiags.some((d) => d.code === "refs/no-unresolved")).toBe(false);
    expect(entryDiags.some((d) => d.code === "syntax-error")).toBe(false);
  });

  test("cross-file extract of a schema containing a YAML alias is suppressed (#56)", async () => {
    const ROOT = "/projy";
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
    const FRAGMENT_TEXT = `defaults: &defaults
  type: string
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
              id: *defaults
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
    expect(results.find((r) => r.title === "Extract inline schema to components")).toBeUndefined();
  });
});

describe("Inline reference", () => {
  test("a $ref scalar Alias is resolved before inlining", async () => {
    const ENTRY_PATH = "/repo/openapi.yaml";
    const TEXT = `openapi: 3.0.3
info: { title: Test, version: "1" }
x-pet-ref: &petRef '#/components/schemas/Pet'
paths:
  /pets:
    get:
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: *petRef
components:
  schemas:
    Pet:
      type: string
`;
    const ctx = createServerContext(new InMemoryFileSystem({ [ENTRY_PATH]: TEXT }));
    const position = positionOf(TEXT, "$ref: *petRef");
    const results = await getCodeActions(ctx, { path: ENTRY_PATH, position, diagnostics: [] });
    const action = results.find((result) => result.title === "Inline reference");

    expect(action).toBeDefined();
    const newText = applyEdits(TEXT, action!.edits);
    expect(newText).not.toContain("$ref: *petRef");
    expect(newText).toContain("              schema:\n                type: string\n");
  });

  test("a scalar-aliased $ref keeps its enclosing JSON Schema resource base", async () => {
    const ENTRY_PATH = "/repo/openapi.yaml";
    const CHILD_PATH = "/repo/scoped/child.yaml";
    const TEXT = `openapi: 3.1.0
info: { title: Test, version: "1" }
x-child-ref: &childRef child.yaml
paths: {}
components:
  schemas:
    Root:
      $id: scoped/root.json
      $defs:
        Use:
          $ref: *childRef
`;
    const ctx = createServerContext(new InMemoryFileSystem({
      [ENTRY_PATH]: TEXT,
      [CHILD_PATH]: "type: string\n",
    }));
    const position = positionOf(TEXT, "$ref: *childRef");
    const results = await getCodeActions(ctx, { path: ENTRY_PATH, position, diagnostics: [] });
    const action = results.find((result) => result.title === "Inline reference");

    expect(action).toBeDefined();
    const newText = applyEdits(TEXT, action!.edits);
    expect(newText).not.toContain("$ref: *childRef");
    expect(newText).toContain("        Use:\n          type: string\n");
  });

  test("same-document ref: replaces the $ref with the target's re-indented content", async () => {
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
`;
    const ctx = createServerContext(new InMemoryFileSystem({ [ENTRY_PATH]: TEXT }));
    const position = positionOf(TEXT, "$ref: '#/components/schemas/Pet'");
    const results = await getCodeActions(ctx, { path: ENTRY_PATH, position, diagnostics: [] });
    const action = results.find((r) => r.title === "Inline reference");
    expect(action).toBeDefined();
    expect(action?.kind).toBe("refactor.inline");
    expect(action?.edits).toHaveLength(1);
    expect(action?.edits[0]?.filePath).toBe(ENTRY_PATH);

    const newText = applyEdits(TEXT, action!.edits);
    expect(newText).not.toContain("$ref: '#/components/schemas/Pet'");
    expect(newText).toContain(
      "              schema:\n                type: object\n                properties:\n                  id:\n                    type: string\n",
    );
    // Pet itself is untouched (still there as a - now possibly unused - component).
    expect(newText).toContain("components:\n  schemas:\n    Pet:\n      type: object");

    const ctx2 = createServerContext(new InMemoryFileSystem({ [ENTRY_PATH]: newText }));
    const diags2 = (await diagnosticsFor(ctx2, ENTRY_PATH)).get(ENTRY_PATH) ?? [];
    expect(diags2.some((d) => d.code === "refs/no-unresolved")).toBe(false);
    expect(diags2.some((d) => d.code === "syntax-error")).toBe(false);
  });

  test("cross-file ref: content is copied from the target file, which is left unchanged", async () => {
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
components:
  schemas:
    Pet:
      type: object
      properties:
        id:
          type: string
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
            $ref: '../openapi.yaml#/components/schemas/Pet'
`;

    const ctx = createServerContext(
      new InMemoryFileSystem({
        [CONFIG_PATH]: `{ "entries": ["openapi.yaml"] }`,
        [ENTRY_PATH]: ENTRY_TEXT,
        [FRAGMENT_PATH]: FRAGMENT_TEXT,
      }),
    );
    await scanWorkspaceRootsForProjects(ctx, [ROOT]);

    const position = positionOf(FRAGMENT_TEXT, "$ref: '../openapi.yaml#/components/schemas/Pet'");
    const results = await getCodeActions(ctx, { path: FRAGMENT_PATH, position, diagnostics: [] });
    const action = results.find((r) => r.title === "Inline reference");
    expect(action).toBeDefined();
    expect(action?.edits).toHaveLength(1);
    expect(action?.edits[0]?.filePath).toBe(FRAGMENT_PATH);

    const newFragmentText = applyEdits(FRAGMENT_TEXT, action!.edits);
    expect(newFragmentText).not.toContain("$ref:");
    expect(newFragmentText).toContain(
      "          schema:\n            type: object\n            properties:\n              id:\n                type: string\n",
    );

    const ctx2 = createServerContext(
      new InMemoryFileSystem({
        [CONFIG_PATH]: `{ "entries": ["openapi.yaml"] }`,
        [ENTRY_PATH]: ENTRY_TEXT,
        [FRAGMENT_PATH]: newFragmentText,
      }),
    );
    const diags2 = (await diagnosticsFor(ctx2, ENTRY_PATH)).get(FRAGMENT_PATH) ?? [];
    expect(diags2.some((d) => d.code === "refs/no-unresolved")).toBe(false);
    expect(diags2.some((d) => d.code === "syntax-error")).toBe(false);
  });

  test("not offered: unresolved $ref target", async () => {
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
                $ref: '#/components/schemas/DoesNotExist'
`;
    const ctx = createServerContext(new InMemoryFileSystem({ [ENTRY_PATH]: TEXT }));
    const position = positionOf(TEXT, "$ref: '#/components/schemas/DoesNotExist'");
    const results = await getCodeActions(ctx, { path: ENTRY_PATH, position, diagnostics: [] });
    expect(results.find((r) => r.title === "Inline reference")).toBeUndefined();
  });

  test("not offered: inlining would loop back into an ancestor (recursive schema)", async () => {
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
components:
  schemas:
    Node:
      type: object
      properties:
        children:
          type: array
          items:
            $ref: '#/components/schemas/Node'
`;
    const ctx = createServerContext(new InMemoryFileSystem({ [ENTRY_PATH]: TEXT }));
    const position = positionOf(TEXT, "$ref: '#/components/schemas/Node'");
    const results = await getCodeActions(ctx, { path: ENTRY_PATH, position, diagnostics: [] });
    expect(results.find((r) => r.title === "Inline reference")).toBeUndefined();
  });

  test("not offered: 3.1 $ref with meaningful siblings", async () => {
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
                description: override
components:
  schemas:
    Pet:
      type: object
`;
    const ctx = createServerContext(new InMemoryFileSystem({ [ENTRY_PATH]: TEXT }));
    const position = positionOf(TEXT, "$ref: '#/components/schemas/Pet'");
    const results = await getCodeActions(ctx, { path: ENTRY_PATH, position, diagnostics: [] });
    expect(results.find((r) => r.title === "Inline reference")).toBeUndefined();
  });

  test("not offered: $ref is a whole Path Item (structural, skipped for now)", async () => {
    const ENTRY_PATH = "/repo/openapi.yaml";
    const TEXT = `openapi: 3.1.0
info:
  title: Test API
  version: "1.0.0"
paths:
  /pets:
    $ref: '#/components/pathItems/PetsItem'
components:
  pathItems:
    PetsItem:
      get:
        operationId: listPets
        responses:
          '200':
            description: OK
`;
    const ctx = createServerContext(new InMemoryFileSystem({ [ENTRY_PATH]: TEXT }));
    const position = positionOf(TEXT, "$ref: '#/components/pathItems/PetsItem'");
    const results = await getCodeActions(ctx, { path: ENTRY_PATH, position, diagnostics: [] });
    expect(results.find((r) => r.title === "Inline reference")).toBeUndefined();
  });

  test("target's subtree contains a relative cross-file ref: it is re-relativized for the destination (#56)", async () => {
    const ROOT = "/proj";
    const CONFIG_PATH = `${ROOT}/oasis.config.jsonc`;
    const ENTRY_PATH = `${ROOT}/openapi.yaml`;
    const SHARED_PATH = `${ROOT}/shared.yaml`;
    const FRAGMENT_PATH = `${ROOT}/paths/pets.yaml`;

    const ENTRY_TEXT = `openapi: 3.1.0
info:
  title: Test API
  version: "1.0.0"
paths:
  /pets:
    $ref: './paths/pets.yaml'
components:
  schemas:
    Wrapper:
      type: object
      properties:
        item:
          $ref: './shared.yaml#/Item'
`;
    const SHARED_TEXT = `Item:
  type: string
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
            $ref: '../openapi.yaml#/components/schemas/Wrapper'
`;

    const ctx = createServerContext(
      new InMemoryFileSystem({
        [CONFIG_PATH]: `{ "entries": ["openapi.yaml"] }`,
        [ENTRY_PATH]: ENTRY_TEXT,
        [SHARED_PATH]: SHARED_TEXT,
        [FRAGMENT_PATH]: FRAGMENT_TEXT,
      }),
    );
    await scanWorkspaceRootsForProjects(ctx, [ROOT]);

    const position = positionOf(FRAGMENT_TEXT, "$ref: '../openapi.yaml#/components/schemas/Wrapper'");
    const results = await getCodeActions(ctx, { path: FRAGMENT_PATH, position, diagnostics: [] });
    const action = results.find((r) => r.title === "Inline reference");
    expect(action).toBeDefined();

    const newFragmentText = applyEdits(FRAGMENT_TEXT, action!.edits);
    // The copied subtree's './shared.yaml#/Item' (relative to openapi.yaml) is rebased for the
    // fragment's directory (paths/), so it still resolves to the same file.
    expect(newFragmentText).toContain("$ref: '../shared.yaml#/Item'");
    expect(newFragmentText).not.toContain("'./shared.yaml#/Item'");

    const ctx2 = createServerContext(
      new InMemoryFileSystem({
        [CONFIG_PATH]: `{ "entries": ["openapi.yaml"] }`,
        [ENTRY_PATH]: ENTRY_TEXT,
        [SHARED_PATH]: SHARED_TEXT,
        [FRAGMENT_PATH]: newFragmentText,
      }),
    );
    await scanWorkspaceRootsForProjects(ctx2, [ROOT]);
    const diags2 = (await diagnosticsFor(ctx2, ENTRY_PATH)).get(FRAGMENT_PATH) ?? [];
    expect(diags2.some((d) => d.code === "refs/no-unresolved")).toBe(false);
    expect(diags2.some((d) => d.code === "syntax-error")).toBe(false);
  });

  test("cross-file inline rewrites the target's same-document refs to point back at the source file (#56)", async () => {
    const ROOT = "/proj2";
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
components:
  schemas:
    Outer:
      type: object
      properties:
        inner:
          $ref: '#/components/schemas/Inner'
    Inner:
      type: string
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
            $ref: '../openapi.yaml#/components/schemas/Outer'
`;

    const ctx = createServerContext(
      new InMemoryFileSystem({
        [CONFIG_PATH]: `{ "entries": ["openapi.yaml"] }`,
        [ENTRY_PATH]: ENTRY_TEXT,
        [FRAGMENT_PATH]: FRAGMENT_TEXT,
      }),
    );
    await scanWorkspaceRootsForProjects(ctx, [ROOT]);

    const position = positionOf(FRAGMENT_TEXT, "$ref: '../openapi.yaml#/components/schemas/Outer'");
    const results = await getCodeActions(ctx, { path: FRAGMENT_PATH, position, diagnostics: [] });
    const action = results.find((r) => r.title === "Inline reference");
    expect(action).toBeDefined();

    const newFragmentText = applyEdits(FRAGMENT_TEXT, action!.edits);
    // The Outer subtree's local '#/components/schemas/Inner' would resolve against the fragment
    // (where there is no components section); it must be rebased to the source document.
    expect(newFragmentText).toContain("$ref: '../openapi.yaml#/components/schemas/Inner'");
    expect(newFragmentText).not.toContain("$ref: '#/components/schemas/Inner'");

    const ctx2 = createServerContext(
      new InMemoryFileSystem({
        [CONFIG_PATH]: `{ "entries": ["openapi.yaml"] }`,
        [ENTRY_PATH]: ENTRY_TEXT,
        [FRAGMENT_PATH]: newFragmentText,
      }),
    );
    await scanWorkspaceRootsForProjects(ctx2, [ROOT]);
    const diags2 = (await diagnosticsFor(ctx2, ENTRY_PATH)).get(FRAGMENT_PATH) ?? [];
    expect(diags2.some((d) => d.code === "refs/no-unresolved")).toBe(false);
    expect(diags2.some((d) => d.code === "syntax-error")).toBe(false);
  });

  test("not offered: cross-file inline of a subtree with a YAML alias (document-scoped, unsafe to copy)", async () => {
    const ROOT = "/proj3";
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
components:
  schemas:
    Base: &base
      type: object
    Outer:
      type: object
      properties:
        inner: *base
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
            $ref: '../openapi.yaml#/components/schemas/Outer'
`;

    const ctx = createServerContext(
      new InMemoryFileSystem({
        [CONFIG_PATH]: `{ "entries": ["openapi.yaml"] }`,
        [ENTRY_PATH]: ENTRY_TEXT,
        [FRAGMENT_PATH]: FRAGMENT_TEXT,
      }),
    );
    await scanWorkspaceRootsForProjects(ctx, [ROOT]);

    const position = positionOf(FRAGMENT_TEXT, "$ref: '../openapi.yaml#/components/schemas/Outer'");
    const results = await getCodeActions(ctx, { path: FRAGMENT_PATH, position, diagnostics: [] });
    expect(results.find((r) => r.title === "Inline reference")).toBeUndefined();
  });

  test("not offered: cross-file inline of a subtree with a nested \$id scope (3.1)", async () => {
    const ROOT = "/proj4";
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
components:
  schemas:
    Outer:
      \$id: 'https://example.com/schemas/outer'
      type: object
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
            $ref: '../openapi.yaml#/components/schemas/Outer'
`;

    const ctx = createServerContext(
      new InMemoryFileSystem({
        [CONFIG_PATH]: `{ "entries": ["openapi.yaml"] }`,
        [ENTRY_PATH]: ENTRY_TEXT,
        [FRAGMENT_PATH]: FRAGMENT_TEXT,
      }),
    );
    await scanWorkspaceRootsForProjects(ctx, [ROOT]);

    const position = positionOf(FRAGMENT_TEXT, "$ref: '../openapi.yaml#/components/schemas/Outer'");
    const results = await getCodeActions(ctx, { path: FRAGMENT_PATH, position, diagnostics: [] });
    expect(results.find((r) => r.title === "Inline reference")).toBeUndefined();
  });

  test("cross-file inline leaves absolute non-filesystem URI refs (urn:, https:) unchanged (#56)", async () => {
    const ROOT = "/proj5";
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
components:
  schemas:
    Outer:
      type: object
      properties:
        ext:
          $ref: 'urn:example:schema'
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
            $ref: '../openapi.yaml#/components/schemas/Outer'
`;

    const ctx = createServerContext(
      new InMemoryFileSystem({
        [CONFIG_PATH]: `{ "entries": ["openapi.yaml"] }`,
        [ENTRY_PATH]: ENTRY_TEXT,
        [FRAGMENT_PATH]: FRAGMENT_TEXT,
      }),
    );
    await scanWorkspaceRootsForProjects(ctx, [ROOT]);

    const position = positionOf(FRAGMENT_TEXT, "$ref: '../openapi.yaml#/components/schemas/Outer'");
    const results = await getCodeActions(ctx, { path: FRAGMENT_PATH, position, diagnostics: [] });
    const action = results.find((r) => r.title === "Inline reference");
    expect(action).toBeDefined();

    const newFragmentText = applyEdits(FRAGMENT_TEXT, action!.edits);
    expect(newFragmentText).toContain("$ref: 'urn:example:schema'");
  });
});

describe("Relocation uses semantic reference discovery (#119)", () => {
  test("cross-directory extract rewrites $ref and discriminator mapping URIs but leaves literal $ref data untouched", async () => {
    const ROOT = "/proj119a";
    const CONFIG_PATH = `${ROOT}/oasis.config.jsonc`;
    const ENTRY_PATH = `${ROOT}/openapi.yaml`;
    const FRAGMENT_PATH = `${ROOT}/paths/pets.yaml`;
    const SHARED_PATH = `${ROOT}/paths/shared.yaml`;
    const MODELS_PATH = `${ROOT}/paths/models.yaml`;

    const ENTRY_TEXT = `openapi: 3.1.0
info:
  title: Test API
  version: "1.0.0"
paths:
  /pets:
    $ref: './paths/pets.yaml'
`;
    // The inline schema mixes: a real \$ref, a discriminator mapping URI (a plain-string reference,
    // not a \{$ref\} object), and a literal example whose payload contains a \$ref-shaped key that is
    // NOT a reference. All three refs are relative to paths/ and must be rebased for the entry dir,
    // while the literal payload must be copied verbatim.
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
            discriminator:
              propertyName: petType
              mapping:
                dog: './models.yaml#/Dog'
            properties:
              petType:
                type: string
              favorite:
                $ref: './shared.yaml#/Item'
              sample:
                type: object
                example:
                  $ref: '#/literal-value'
`;
    const SHARED_TEXT = `Item:
  type: string
`;
    const MODELS_TEXT = `Dog:
  type: object
`;

    const ctx = createServerContext(
      new InMemoryFileSystem({
        [CONFIG_PATH]: `{ "entries": ["openapi.yaml"] }`,
        [ENTRY_PATH]: ENTRY_TEXT,
        [FRAGMENT_PATH]: FRAGMENT_TEXT,
        [SHARED_PATH]: SHARED_TEXT,
        [MODELS_PATH]: MODELS_TEXT,
      }),
    );
    await scanWorkspaceRootsForProjects(ctx, [ROOT]);

    const position = positionOf(FRAGMENT_TEXT, "type: object\n            discriminator:");
    const results = await getCodeActions(ctx, { path: FRAGMENT_PATH, position, diagnostics: [] });
    const action = results.find((r) => r.title === "Extract inline schema to components");
    expect(action).toBeDefined();

    const fragmentEdit = action!.edits.find((e) => e.filePath === FRAGMENT_PATH)!;
    const entryEdit = action!.edits.find((e) => e.filePath === ENTRY_PATH)!;
    const newFragmentText = applyEdits(FRAGMENT_TEXT, [fragmentEdit]);
    const newEntryText = applyEdits(ENTRY_TEXT, [entryEdit]);

    // Genuine references are rebased from paths/ to the entry directory.
    expect(newEntryText).toContain("$ref: './paths/shared.yaml#/Item'");
    expect(newEntryText).toContain("dog: './paths/models.yaml#/Dog'");
    // The literal example payload is copied verbatim — its $ref-shaped key is plain data.
    expect(newEntryText).toContain("$ref: '#/literal-value'");
    expect(newEntryText).not.toContain("./paths/#/literal-value");

    // Re-lint the relocated result: every rewritten reference must still resolve, and no syntax error.
    const ctx2 = createServerContext(
      new InMemoryFileSystem({
        [CONFIG_PATH]: `{ "entries": ["openapi.yaml"] }`,
        [ENTRY_PATH]: newEntryText,
        [FRAGMENT_PATH]: newFragmentText,
        [SHARED_PATH]: SHARED_TEXT,
        [MODELS_PATH]: MODELS_TEXT,
      }),
    );
    await scanWorkspaceRootsForProjects(ctx2, [ROOT]);
    const entryDiags = (await diagnosticsFor(ctx2, ENTRY_PATH)).get(ENTRY_PATH) ?? [];
    expect(entryDiags.some((d) => d.code === "refs/no-unresolved")).toBe(false);
    expect(entryDiags.some((d) => d.code === "syntax-error")).toBe(false);
  });

  test("cross-directory inline rebases discriminator mapping URIs and leaves literal $ref data untouched", async () => {
    const ROOT = "/proj119b";
    const CONFIG_PATH = `${ROOT}/oasis.config.jsonc`;
    const ENTRY_PATH = `${ROOT}/openapi.yaml`;
    const FRAGMENT_PATH = `${ROOT}/paths/pets.yaml`;
    const SHARED_PATH = `${ROOT}/shared.yaml`;
    const MODELS_PATH = `${ROOT}/models/dog.yaml`;

    // The target schema (in the entry) carries a discriminator mapping URI, an ordinary \$ref, and a
    // literal example holding a \$ref-shaped key. When inlined into the fragment under paths/, the two
    // genuine references must be re-relativized while the literal payload stays as-is (it must NOT be
    // rewritten to '../openapi.yaml#/literal-value').
    const ENTRY_TEXT = `openapi: 3.1.0
info:
  title: Test API
  version: "1.0.0"
paths:
  /pets:
    $ref: './paths/pets.yaml'
components:
  schemas:
    Animal:
      type: object
      discriminator:
        propertyName: petType
        mapping:
          dog: './models/dog.yaml#/Dog'
      properties:
        favorite:
          $ref: './shared.yaml#/Item'
        sample:
          type: object
          example:
            $ref: '#/literal-value'
`;
    const SHARED_TEXT = `Item:
  type: string
`;
    const MODELS_TEXT = `Dog:
  type: object
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
            $ref: '../openapi.yaml#/components/schemas/Animal'
`;

    const ctx = createServerContext(
      new InMemoryFileSystem({
        [CONFIG_PATH]: `{ "entries": ["openapi.yaml"] }`,
        [ENTRY_PATH]: ENTRY_TEXT,
        [FRAGMENT_PATH]: FRAGMENT_TEXT,
        [SHARED_PATH]: SHARED_TEXT,
        [MODELS_PATH]: MODELS_TEXT,
      }),
    );
    await scanWorkspaceRootsForProjects(ctx, [ROOT]);

    const position = positionOf(FRAGMENT_TEXT, "$ref: '../openapi.yaml#/components/schemas/Animal'");
    const results = await getCodeActions(ctx, { path: FRAGMENT_PATH, position, diagnostics: [] });
    const action = results.find((r) => r.title === "Inline reference");
    expect(action).toBeDefined();

    const newFragmentText = applyEdits(FRAGMENT_TEXT, action!.edits);

    // Entry-relative genuine references are re-relativized for the fragment's directory (paths/).
    expect(newFragmentText).toContain("dog: '../models/dog.yaml#/Dog'");
    expect(newFragmentText).toContain("$ref: '../shared.yaml#/Item'");
    // The literal example payload is untouched — not rebased to the source document.
    expect(newFragmentText).toContain("$ref: '#/literal-value'");
    expect(newFragmentText).not.toContain("openapi.yaml#/literal-value");

    const ctx2 = createServerContext(
      new InMemoryFileSystem({
        [CONFIG_PATH]: `{ "entries": ["openapi.yaml"] }`,
        [ENTRY_PATH]: ENTRY_TEXT,
        [FRAGMENT_PATH]: newFragmentText,
        [SHARED_PATH]: SHARED_TEXT,
        [MODELS_PATH]: MODELS_TEXT,
      }),
    );
    await scanWorkspaceRootsForProjects(ctx2, [ROOT]);
    const fragDiags = (await diagnosticsFor(ctx2, ENTRY_PATH)).get(FRAGMENT_PATH) ?? [];
    expect(fragDiags.some((d) => d.code === "refs/no-unresolved")).toBe(false);
    expect(fragDiags.some((d) => d.code === "syntax-error")).toBe(false);
  });
});

describe("JSON documents get no relocation code actions (#56)", () => {
  test("inline and extract are not offered for a JSON entry document", async () => {
    const ENTRY_PATH = "/repo/openapi.json";
    const TEXT = JSON.stringify(
      {
        openapi: "3.1.0",
        info: { title: "Test", version: "1.0.0" },
        paths: {
          "/pets": {
            get: {
              operationId: "listPets",
              responses: {
                "200": {
                  description: "OK",
                  content: { "application/json": { schema: { $ref: "#/components/schemas/Pet" } } },
                },
              },
            },
          },
        },
        components: { schemas: { Pet: { type: "object" } } },
      },
      null,
      2,
    );
    const ctx = createServerContext(new InMemoryFileSystem({ [ENTRY_PATH]: TEXT }));
    const position = positionOf(TEXT, '"$ref": "#/components/schemas/Pet"');
    const results = await getCodeActions(ctx, { path: ENTRY_PATH, position, diagnostics: [] });
    expect(results).toEqual([]);
  });
});
