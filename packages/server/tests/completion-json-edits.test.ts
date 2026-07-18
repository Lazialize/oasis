import { describe, expect, test } from "bun:test";
import { InMemoryFileSystem } from "@oasis/core";
import { getCompletions } from "../src/handlers/completion.ts";
import type { CompletionItem } from "../src/handlers/completion.ts";
import { createServerContext } from "../src/workspace.ts";
import { positionOf } from "./helpers.ts";

const JSON_PATH = "/repo/entry.json";

/** Apply a completion item's textEdit (single-line) to `text`, returning the resulting buffer. */
function applyEdit(text: string, item: CompletionItem): string {
  const edit = item.textEdit;
  if (!edit) throw new Error(`item ${item.label} has no textEdit`);
  const lines = text.split("\n");
  const { start, end } = edit.range;
  if (start.line !== end.line) throw new Error("multi-line edit not supported by this helper");
  const line = lines[start.line]!;
  lines[start.line] = line.slice(0, start.character) + edit.newText + line.slice(end.character);
  return lines.join("\n");
}

async function completionsAt(text: string, position: { line: number; character: number }) {
  const ctx = createServerContext(new InMemoryFileSystem({ [JSON_PATH]: text }));
  return getCompletions(ctx, { path: JSON_PATH, position });
}

/** Position of the cursor marked by `|` in `marked`; returns the text with the marker removed. */
function cursor(marked: string): { text: string; position: { line: number; character: number } } {
  const idx = marked.indexOf("|");
  if (idx === -1) throw new Error("no cursor marker");
  const text = marked.slice(0, idx) + marked.slice(idx + 1);
  const before = text.slice(0, idx).split("\n");
  return { text, position: { line: before.length - 1, character: before[before.length - 1]!.length } };
}

describe("JSON key completion edits", () => {
  test("root key after an existing member with a trailing comma: quoted, no leading comma", async () => {
    const { text, position } = cursor(`{
  "openapi": "3.1.0",
  |
}
`);
    const items = await completionsAt(text, position);
    const servers = items.find((i) => i.label === "servers");
    expect(servers).toBeDefined();
    expect(servers?.textEdit?.newText).toBe('"servers": ');
    // Applying the edit and giving the new key a value yields valid JSON.
    const applied = applyEdit(text, servers!).replace('"servers": ', '"servers": []');
    expect(() => JSON.parse(applied)).not.toThrow();
  });

  test("root key after a member with NO trailing comma: adds a leading comma", async () => {
    const { text, position } = cursor(`{
  "openapi": "3.1.0"
  |
}
`);
    const items = await completionsAt(text, position);
    const servers = items.find((i) => i.label === "servers");
    expect(servers?.textEdit?.newText).toBe(',"servers": ');
    const applied = applyEdit(text, servers!).replace('"servers": ', '"servers": []');
    expect(() => JSON.parse(applied)).not.toThrow();
  });

  test("first key in an otherwise empty object: no leading comma", async () => {
    const { text, position } = cursor(`{
  "openapi": "3.1.0",
  "info": {
    |
  }
}
`);
    const items = await completionsAt(text, position);
    const title = items.find((i) => i.label === "title");
    expect(title?.textEdit?.newText).toBe('"title": ');
    const applied = applyEdit(text, title!).replace('"title": ', '"title": "x"');
    expect(() => JSON.parse(applied)).not.toThrow();
  });

  test("existing keys are excluded", async () => {
    const { text, position } = cursor(`{
  "openapi": "3.1.0",
  "info": {},
  |
}
`);
    const items = await completionsAt(text, position);
    expect(items.some((i) => i.label === "openapi")).toBe(false);
    expect(items.some((i) => i.label === "info")).toBe(false);
    expect(items.some((i) => i.label === "paths")).toBe(true);
  });

  test("no key edit is offered before a following sibling member (would need a trailing comma)", async () => {
    const { text, position } = cursor(`{
  "openapi": "3.1.0",
  |"info": {}
}
`);
    const items = await completionsAt(text, position);
    expect(items).toEqual([]);
  });

  test("never emits YAML-style bare keys in JSON", async () => {
    const { text, position } = cursor(`{
  "openapi": "3.1.0",
  |
}
`);
    const items = await completionsAt(text, position);
    for (const item of items) {
      expect(item.textEdit?.newText).not.toMatch(/^[a-z]/i); // JSON keys start with `"` or `,`
      expect(item.insertText).not.toMatch(/^[a-z]/i);
    }
  });
});

describe("JSON $ref completion edits", () => {
  const base = `{
  "openapi": "3.1.0",
  "info": { "title": "T", "version": "1.0.0" },
  "paths": {
    "/pets": {
      "get": {
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": { %REF% }
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

  test("empty `$ref` value: emits a double-quoted target (valid JSON)", async () => {
    const text = base.replace("%REF%", '"$ref": ');
    const position = positionOf(text, '"$ref": ');
    const line = text.split("\n")[position.line]!;
    // Cursor right after `"$ref": ` (before the `}` that follows on the same line).
    const c = { line: position.line, character: line.indexOf('"$ref": ') + '"$ref": '.length };
    const items = await completionsAt(text, c);
    const pet = items.find((i) => i.label === "#/components/schemas/Pet");
    expect(pet?.textEdit?.newText).toBe('"#/components/schemas/Pet"');
    const applied = applyEdit(text, pet!);
    expect(() => JSON.parse(applied)).not.toThrow();
  });

  test("partial double-quoted `$ref` value: replaces the typed text, quote already closed", async () => {
    // Keep the closing quote so the document still parses; cursor sits just before it.
    const text = base.replace("%REF%", '"$ref": "#/comp"');
    const position = positionOf(text, '"$ref": "#/comp"');
    const line = text.split("\n")[position.line]!;
    const c = { line: position.line, character: line.indexOf('#/comp"') + "#/comp".length };
    const items = await completionsAt(text, c);
    const pet = items.find((i) => i.label === "#/components/schemas/Pet");
    expect(pet?.filterText).toBe("#/components/schemas/Pet");
    // Closing quote already present -> replace only the value text, no extra quote appended.
    expect(pet?.textEdit?.newText).toBe("#/components/schemas/Pet");
    const applied = applyEdit(text, pet!);
    expect(() => JSON.parse(applied)).not.toThrow();
  });
});

describe("JSONC completion edits", () => {
  test("`.jsonc` documents are treated as JSON: quoted key edits", async () => {
    const path = "/repo/entry.jsonc";
    const text = `{
  // a comment
  "openapi": "3.1.0",
  \n}
`;
    const ctx = createServerContext(new InMemoryFileSystem({ [path]: text }));
    const position = { line: 3, character: 2 };
    const items = await getCompletions(ctx, { path, position });
    const servers = items.find((i) => i.label === "servers");
    expect(servers?.textEdit?.newText).toBe('"servers": ');
  });
});
