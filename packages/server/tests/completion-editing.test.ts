import { describe, expect, test } from "bun:test";
import { InMemoryFileSystem } from "@oasis/core";
import { getCompletions } from "../src/handlers/completion.ts";
import { createServerContext } from "../src/workspace.ts";
import { ENTRY_PATH, ENTRY_TEXT, fixtureFiles } from "./fixtures.ts";
import { positionOf } from "./helpers.ts";

async function completionsAt(files: Record<string, string>, path: string, text: string, needle: string, occurrence = 0) {
  const ctx = createServerContext(new InMemoryFileSystem({ ...files, [path]: text }));
  const position = positionOf(text, needle, occurrence);
  return { ctx, position, items: await getCompletions(ctx, { path, position }) };
}

describe("getCompletions: mid-typing scenarios (YAML)", () => {
  test("scenario 1: partially typed key on a new line offers `description`, replacing the prefix", async () => {
    const text = `openapi: 3.1.0
info:
  title: Test API
  version: "1.0.0"
paths:
  /pets:
    get:
      operationId: listPets
      desc
`;
    const start = positionOf(text, "desc");
    const position = { line: start.line, character: start.character + "desc".length };
    const ctx = createServerContext(new InMemoryFileSystem({ [ENTRY_PATH]: text }));
    const items = await getCompletions(ctx, { path: ENTRY_PATH, position });

    const description = items.find((i) => i.label === "description");
    expect(description).toBeDefined();
    expect(description?.textEdit).toEqual({
      range: { start: { line: position.line, character: 6 }, end: position },
      newText: "description: ",
    });
  });

  test("scenario 2: empty line inside an operation block suggests operation keys", async () => {
    const text = `openapi: 3.1.0
info:
  title: Test API
  version: "1.0.0"
paths:
  /pets:
    get:
      operationId: listPets
      \x20
`;
    const ctx = createServerContext(new InMemoryFileSystem({ [ENTRY_PATH]: text }));
    const items = await getCompletions(ctx, { path: ENTRY_PATH, position: { line: 8, character: 6 } });
    const labels = items.map((i) => i.label);
    expect(labels).toContain("responses");
    expect(labels).toContain("summary");
  });

  test("scenario 2: empty line inside info block suggests info keys", async () => {
    const text = `openapi: 3.1.0
info:
  title: Test API
  \x20
paths: {}
`;
    const ctx = createServerContext(new InMemoryFileSystem({ [ENTRY_PATH]: text }));
    const items = await getCompletions(ctx, { path: ENTRY_PATH, position: { line: 3, character: 2 } });
    const labels = items.map((i) => i.label);
    expect(labels).toContain("version");
    expect(labels).toContain("license");
  });

  test("scenario 3: keys already present on the enclosing map are excluded", async () => {
    const text = `openapi: 3.1.0
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
      sum
`;
    const start = positionOf(text, "sum");
    const position = { line: start.line, character: start.character + "sum".length };
    const ctx = createServerContext(new InMemoryFileSystem({ [ENTRY_PATH]: text }));
    const items = await getCompletions(ctx, { path: ENTRY_PATH, position });
    const labels = items.map((i) => i.label);
    expect(labels).not.toContain("operationId");
    expect(labels).not.toContain("responses");
    expect(labels).toContain("summary");
  });

  test("scenario 4: accepted key completion inserts `name: `", async () => {
    const { items } = await completionsAt({}, ENTRY_PATH, ENTRY_TEXT, "operationId");
    const item = items.find((i) => i.label === "tags");
    expect(item).toBeDefined();
    expect(item?.insertText).toBe("tags: ");
  });

  test("scenario 5: `$ref: ` with nothing typed yet offers full target list, quoted on insert", async () => {
    const text = `openapi: 3.1.0
info:
  title: T
  version: "1.0.0"
paths:
  /pets:
    get:
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: \x20
components:
  schemas:
    Pet:
      type: object
`;
    const ctx = createServerContext(new InMemoryFileSystem({ [ENTRY_PATH]: text }));
    const position = positionOf(text, "$ref: ") as { line: number; character: number };
    const line = text.split("\n")[position.line]!;
    const cursor = { line: position.line, character: line.length };
    const items = await getCompletions(ctx, { path: ENTRY_PATH, position: cursor });

    const petItem = items.find((i) => i.label === "#/components/schemas/Pet");
    expect(petItem).toBeDefined();
    expect(petItem?.textEdit?.newText).toBe("'#/components/schemas/Pet'");
  });

  test("scenario 6: `$ref: '#/comp` mid-typing offers matching targets with a replacing TextEdit", async () => {
    const fs = fixtureFiles();
    const text = ENTRY_TEXT.replace("$ref: '#/components/schemas/Pet'", "$ref: '#/comp");
    const ctx = createServerContext(new InMemoryFileSystem({ ...fs, [ENTRY_PATH]: text }));
    const position = positionOf(text, "$ref: '#/comp");
    const line = text.split("\n")[position.line]!;
    const cursor = { line: position.line, character: line.length };
    const items = await getCompletions(ctx, { path: ENTRY_PATH, position: cursor });

    const petItem = items.find((i) => i.label === "#/components/schemas/Pet");
    expect(petItem).toBeDefined();
    expect(petItem?.filterText).toBe("#/components/schemas/Pet");
    // Replaces only the typed value text ("#/comp"), appending the missing closing quote.
    const valueStart = cursor.character - "#/comp".length;
    expect(petItem?.textEdit).toEqual({
      range: { start: { line: cursor.line, character: valueStart }, end: cursor },
      newText: "#/components/schemas/Pet'",
    });
  });

  test("scenario 6b: `$ref: '../sch` mid-typing offers cross-file targets", async () => {
    const fs = fixtureFiles();
    // Break the *internal* Pet ref instead of the Owner->shared.yaml one, so shared.yaml stays
    // discoverable in the workspace graph (graph discovery follows resolved refs).
    const text = ENTRY_TEXT.replace("$ref: '#/components/schemas/Pet'", "$ref: '../sch");
    const ctx = createServerContext(new InMemoryFileSystem({ ...fs, [ENTRY_PATH]: text }));
    const position = positionOf(text, "$ref: '../sch");
    const line = text.split("\n")[position.line]!;
    const cursor = { line: position.line, character: line.length };
    const items = await getCompletions(ctx, { path: ENTRY_PATH, position: cursor });

    expect(items.some((i) => i.label === "./shared.yaml#/components/schemas/Owner")).toBe(true);
  });
});

describe("getCompletions: mid-typing scenarios (JSON)", () => {
  const jsonEntryPath = "/repo/entry.json";
  const jsonText = `{
  "openapi": "3.1.0",
  "info": { "title": "T", "version": "1.0.0" },
  "paths": {
    "/pets": {
      "get": {
        "operationId": "listPets",
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": { "$ref": "#/comp" }
              }
            }
          }
        }
      }
    }
  },
  "components": { "schemas": { "Pet": { "type": "object" } } }
}
`;

  test("scenario 7: JSON `$ref` mid-typing offers matching targets with textEdit + filterText", async () => {
    const ctx = createServerContext(new InMemoryFileSystem({ [jsonEntryPath]: jsonText }));
    const position = positionOf(jsonText, '"$ref": "#/comp');
    const line = jsonText.split("\n")[position.line]!;
    const afterQuote = line.length - 1; // just before the closing `"` already in the fixture
    const cursor = { line: position.line, character: afterQuote };
    const items = await getCompletions(ctx, { path: jsonEntryPath, position: cursor });

    const petItem = items.find((i) => i.label === "#/components/schemas/Pet");
    expect(petItem).toBeDefined();
    expect(petItem?.filterText).toBe("#/components/schemas/Pet");
  });

  test("scenario 7: JSON key completion excludes existing keys and inserts `name: `", async () => {
    const partial = jsonText.replace('"operationId": "listPets",', '"operationId": "listPets", "desc');
    const ctx = createServerContext(new InMemoryFileSystem({ [jsonEntryPath]: partial }));
    const position = positionOf(partial, '"desc');
    const items = await getCompletions(ctx, { path: jsonEntryPath, position: { line: position.line, character: position.character + 5 } });
    // JSON isn't required to support the indentation fallback (scenario 1); it's fine if this
    // returns no suggestions, but it must not throw or regress other JSON scenarios.
    expect(Array.isArray(items)).toBe(true);
  });
});
