import { describe, expect, test } from "bun:test";
import { InMemoryFileSystem } from "@oasis/core";
import { getCompletions } from "../src/handlers/completion.ts";
import { getHover } from "../src/handlers/hover.ts";
import { scanWorkspaceRootsForProjects } from "../src/project.ts";
import { createServerContext } from "../src/workspace.ts";
import { positionOf } from "./helpers.ts";

const ROOT = "/semantic-fragments";
const CONFIG_PATH = `${ROOT}/oasis.config.jsonc`;
const ENTRY_PATH = `${ROOT}/openapi.yaml`;
const SCHEMA_PATH = `${ROOT}/fragments/schema.yaml`;
const PATH_ITEM_PATH = `${ROOT}/fragments/path-item.yaml`;
const RESPONSE_PATH = `${ROOT}/fragments/response.yaml`;
const PARAMETER_PATH = `${ROOT}/fragments/parameter.yaml`;
const LIBRARY_PATH = `${ROOT}/fragments/library.yaml`;

const FRAGMENTS: Record<string, string> = {
  [SCHEMA_PATH]: "type: object\nproperties: {}\n",
  [PATH_ITEM_PATH]: "parameters: []\n",
  [RESPONSE_PATH]: "{}\n",
  [PARAMETER_PATH]: "name: petId\nin: query\n",
  [LIBRARY_PATH]: "Pet:\n  type: object\n",
};

function entryText(version: "3.0.3" | "3.1.0"): string {
  return `openapi: ${version}
info:
  title: Semantic fragments
  version: "1.0.0"
paths:
  /pets:
    $ref: './fragments/path-item.yaml'
  /pets/{id}:
    get:
      parameters:
        - $ref: './fragments/parameter.yaml'
      responses:
        '200':
          $ref: './fragments/response.yaml'
components:
  schemas:
    Pet:
      $ref: './fragments/schema.yaml'
    LibraryPet:
      $ref: './fragments/library.yaml#/Pet'
`;
}

async function project(version: "3.0.3" | "3.1.0") {
  const entry = entryText(version);
  const ctx = createServerContext(new InMemoryFileSystem({
    [CONFIG_PATH]: `{ "entries": ["openapi.yaml"] }`,
    [ENTRY_PATH]: entry,
    ...FRAGMENTS,
  }));
  await scanWorkspaceRootsForProjects(ctx, [ROOT]);
  return { ctx, entry };
}

function endPosition(text: string): { line: number; character: number } {
  return { line: text.split("\n").length - 1, character: 0 };
}

async function rootCompletionLabels(
  ctx: ReturnType<typeof createServerContext>,
  path: string,
): Promise<string[]> {
  const text = FRAGMENTS[path]!;
  const items = await getCompletions(ctx, { path, position: endPosition(text) });
  return items.map((item) => item.label);
}

describe("semantic root kinds for whole-document fragments", () => {
  for (const { version, schemaKey, otherVersionKey } of [
    { version: "3.0.3" as const, schemaKey: "nullable", otherVersionKey: "const" },
    { version: "3.1.0" as const, schemaKey: "const", otherVersionKey: "nullable" },
  ]) {
    test(`${version}: root completions use the referring container's object kind`, async () => {
      const { ctx } = await project(version);

      const schema = await rootCompletionLabels(ctx, SCHEMA_PATH);
      expect(schema).toContain(schemaKey);
      expect(schema).not.toContain(otherVersionKey);
      expect(schema).not.toContain("openapi");

      const pathItem = await rootCompletionLabels(ctx, PATH_ITEM_PATH);
      expect(pathItem).toContain("get");
      expect(pathItem).not.toContain("openapi");

      const response = await rootCompletionLabels(ctx, RESPONSE_PATH);
      expect(response).toContain("description");
      expect(response).toContain("content");
      expect(response).not.toContain("openapi");

      const parameter = await rootCompletionLabels(ctx, PARAMETER_PATH);
      expect(parameter).toContain("required");
      expect(parameter).toContain("schema");
      expect(parameter).not.toContain("openapi");
    });

    test(`${version}: hover names whole-document targets from the referring container`, async () => {
      const { ctx, entry } = await project(version);

      for (const [ref, name] of [
        ["./fragments/schema.yaml", "Schema Object"],
        ["./fragments/path-item.yaml", "Path Item Object"],
        ["./fragments/response.yaml", "Response Object"],
        ["./fragments/parameter.yaml", "Parameter Object"],
      ] as const) {
        const result = await getHover(ctx, { path: ENTRY_PATH, position: positionOf(entry, ref) });
        expect(result?.contents).toContain(`**${name}**`);
      }
    });
  }

  test("a pointer-qualified ref does not assign its object kind to the target document root", async () => {
    const { ctx } = await project("3.1.0");

    const library = await rootCompletionLabels(ctx, LIBRARY_PATH);
    expect(library).toContain("openapi");
    expect(library).not.toContain("const");
  });
});
