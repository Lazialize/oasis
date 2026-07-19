import { describe, expect, test } from "bun:test";
import { InMemoryFileSystem, loadWorkspaceGraph, parseRefString, resolveFileReference } from "@oasis/core";
import { keyCompletionsForPointer, refCompletionsForPointer } from "../src/handlers/completion.ts";
import { ENTRY_PATH, fixtureFiles } from "./fixtures.ts";

describe("keyCompletionsForPointer", () => {
  test("root position suggests top-level OpenAPI keys", () => {
    const labels = keyCompletionsForPointer("", "3.1").map((i) => i.label);
    expect(labels).toContain("openapi");
    expect(labels).toContain("paths");
    expect(labels).toContain("components");
  });

  test("operation position suggests operation keys", () => {
    const labels = keyCompletionsForPointer("/paths/~1pets/get", "3.1").map((i) => i.label);
    expect(labels).toContain("operationId");
    expect(labels).toContain("responses");
    expect(labels).toContain("requestBody");
  });

  test("excludes keys already present on the object", () => {
    const labels = keyCompletionsForPointer("/paths/~1pets/get", "3.1", ["operationId", "responses"]).map((i) => i.label);
    expect(labels).not.toContain("operationId");
    expect(labels).not.toContain("responses");
    expect(labels).toContain("summary");
  });

  test("schema position: 3.0 offers `nullable`, not `const`/`examples`", () => {
    const labels = keyCompletionsForPointer("/components/schemas/Pet", "3.0").map((i) => i.label);
    expect(labels).toContain("nullable");
    expect(labels).not.toContain("const");
    expect(labels).not.toContain("examples");
  });

  test("schema position: 3.1 offers `const`/`examples`, not `nullable`", () => {
    const labels = keyCompletionsForPointer("/components/schemas/Pet", "3.1").map((i) => i.label);
    expect(labels).not.toContain("nullable");
    expect(labels).toContain("const");
    expect(labels).toContain("examples");
  });

  test("unclassifiable pointer yields no suggestions", () => {
    // A scalar leaf (`info.title`) is not an object with its own key set.
    expect(keyCompletionsForPointer("/info/title", "3.1")).toEqual([]);
  });

  test("server object position suggests Server Object keys", () => {
    const labels = keyCompletionsForPointer("/servers/0", "3.1").map((i) => i.label);
    expect(labels).toEqual(["url", "description", "variables"]);
  });
});

describe("refCompletionsForPointer", () => {
  test("lists internal and cross-file schema targets", async () => {
    const fs = new InMemoryFileSystem(fixtureFiles());
    const graph = await loadWorkspaceGraph(fs, ENTRY_PATH);
    const entryDoc = graph.documents.get(ENTRY_PATH)!;

    const items = refCompletionsForPointer(entryDoc, graph, "/paths/~1pets/get/responses/200/content/application~1json/schema/$ref").map(
      (i) => i.label,
    );

    expect(items).toContain("#/components/schemas/Pet");
    expect(items).toContain("#/components/schemas/Owner");
    expect(items).toContain("./shared.yaml#/components/schemas/Owner");
  });

  test("no suggestions when the containing object isn't a known component-backed kind", async () => {
    const fs = new InMemoryFileSystem(fixtureFiles());
    const graph = await loadWorkspaceGraph(fs, ENTRY_PATH);
    const entryDoc = graph.documents.get(ENTRY_PATH)!;

    expect(refCompletionsForPointer(entryDoc, graph, "/info/$ref")).toEqual([]);
  });

  describe("cross-file target filenames with reserved/special characters (#121)", () => {
    const ENTRY = "/repo/entry.yaml";
    // `#` must never be mistaken for the fragment delimiter; `%`, space, quotes, and Unicode must
    // survive a round trip through both YAML (single-quoted) and JSON (double-quoted) syntax.
    const REF_POINTER = "/paths/~1pets/get/responses/200/content/application~1json/schema/$ref";
    // Dummy `$ref`s (pre-encoded by hand, independent of the code under test) pull each target file
    // into the workspace graph — `loadWorkspaceGraph` only loads files reachable from the entry.
    const TARGETS: Record<string, string> = {
      [ENTRY]:
        `openapi: 3.1.0\ninfo:\n  title: Test\n  version: "1.0.0"\n` +
        `paths:\n  /pets:\n    get:\n      responses:\n        '200':\n          description: OK\n          content:\n            application/json:\n              schema: {}\n` +
        `components:\n  schemas:\n` +
        `    _pullFoo:\n      $ref: './foo%23bar.yaml#/components/schemas/Foo'\n` +
        `    _pullPercent:\n      $ref: './100%25.yaml#/components/schemas/Percent'\n` +
        `    _pullSpaced:\n      $ref: './my%20file.yaml#/components/schemas/Spaced'\n` +
        `    _pullQuoted:\n      $ref: './it%27s%20%22a%22.yaml#/components/schemas/Quoted'\n` +
        `    _pullUnicode:\n      $ref: './caf%C3%A9.yaml#/components/schemas/Unicode'\n`,
      "/repo/foo#bar.yaml": "components:\n  schemas:\n    Foo:\n      type: string\n",
      "/repo/100%.yaml": "components:\n  schemas:\n    Percent:\n      type: string\n",
      "/repo/my file.yaml": "components:\n  schemas:\n    Spaced:\n      type: string\n",
      "/repo/it's \"a\".yaml": "components:\n  schemas:\n    Quoted:\n      type: string\n",
      "/repo/café.yaml": "components:\n  schemas:\n    Unicode:\n      type: string\n",
    };

    function labelFor(items: ReturnType<typeof refCompletionsForPointer>, schemaName: string): string {
      const item = items.find((i) => i.label.endsWith(`/${schemaName}`) || i.label === `#/components/schemas/${schemaName}`);
      if (!item) throw new Error(`no completion for ${schemaName}`);
      return item.label;
    }

    /** The generated file part must resolve back to the exact file it was generated for, both as a
     * raw path (as `parseRefString`+`resolveFileReference` would see it) and when re-embedded in
     * YAML (single-quoted) and JSON (double-quoted) source text and re-parsed from there. */
    function assertRoundTrips(label: string, expectedFilePath: string, fs: InMemoryFileSystem) {
      const { filePart } = parseRefString(label);
      expect(resolveFileReference(fs, ENTRY, filePart)).toBe(expectedFilePath);

      const yamlText = `$ref: '${label}'`;
      const yamlValue = /^\$ref: '(.*)'$/.exec(yamlText)![1]!;
      expect(resolveFileReference(fs, ENTRY, parseRefString(yamlValue).filePart)).toBe(expectedFilePath);

      const jsonText = JSON.stringify({ $ref: label });
      const jsonValue = (JSON.parse(jsonText) as { $ref: string }).$ref;
      expect(resolveFileReference(fs, ENTRY, parseRefString(jsonValue).filePart)).toBe(expectedFilePath);
    }

    test("generated labels are percent-encoded and resolve back to the intended file", async () => {
      const fs = new InMemoryFileSystem(TARGETS);
      const graph = await loadWorkspaceGraph(fs, ENTRY);
      const entryDoc = graph.documents.get(ENTRY)!;

      const items = refCompletionsForPointer(entryDoc, graph, REF_POINTER);

      const hashLabel = labelFor(items, "Foo");
      expect(hashLabel).toBe("./foo%23bar.yaml#/components/schemas/Foo");
      assertRoundTrips(hashLabel, "/repo/foo#bar.yaml", fs);

      const percentLabel = labelFor(items, "Percent");
      expect(percentLabel).toBe("./100%25.yaml#/components/schemas/Percent");
      assertRoundTrips(percentLabel, "/repo/100%.yaml", fs);

      const spaceLabel = labelFor(items, "Spaced");
      expect(spaceLabel).toBe("./my%20file.yaml#/components/schemas/Spaced");
      assertRoundTrips(spaceLabel, "/repo/my file.yaml", fs);

      const quoteLabel = labelFor(items, "Quoted");
      expect(quoteLabel).toBe("./it%27s%20%22a%22.yaml#/components/schemas/Quoted");
      assertRoundTrips(quoteLabel, "/repo/it's \"a\".yaml", fs);

      const unicodeLabel = labelFor(items, "Unicode");
      expect(unicodeLabel).toBe("./caf%C3%A9.yaml#/components/schemas/Unicode");
      assertRoundTrips(unicodeLabel, "/repo/café.yaml", fs);
    });

    test("the same encoding is used for the YAML textEdit insertion", async () => {
      const fs = new InMemoryFileSystem(TARGETS);
      const graph = await loadWorkspaceGraph(fs, ENTRY);
      const entryDoc = graph.documents.get(ENTRY)!;

      const items = refCompletionsForPointer(entryDoc, graph, REF_POINTER, "root", {
        quoteChar: undefined,
        hasClosingQuote: false,
        replaceRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      });
      const item = items.find((i) => i.label.includes("foo%23bar"))!;
      expect(item.textEdit?.newText).toBe("'./foo%23bar.yaml#/components/schemas/Foo'");
    });

    test("the same encoding is used for the JSON textEdit insertion", async () => {
      const fs = new InMemoryFileSystem(TARGETS);
      const graph = await loadWorkspaceGraph(fs, ENTRY);
      const entryDoc = graph.documents.get(ENTRY)!;

      const items = refCompletionsForPointer(
        entryDoc,
        graph,
        REF_POINTER,
        "root",
        {
          quoteChar: undefined,
          hasClosingQuote: false,
          replaceRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        },
        "json",
      );
      const item = items.find((i) => i.label.includes("foo%23bar"))!;
      expect(item.textEdit?.newText).toBe('"./foo%23bar.yaml#/components/schemas/Foo"');
    });
  });
});
