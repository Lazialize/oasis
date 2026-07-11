import { describe, expect, test } from "bun:test";
import { InMemoryFileSystem } from "@oasis/core";
import { getDiagnosticsByFile } from "../src/diagnostics.ts";
import { routeDocument } from "../src/document-routing.ts";
import { getCompletions } from "../src/handlers/completion.ts";
import { getDefinition } from "../src/handlers/definition.ts";
import { loadProjectConfig } from "../src/project.ts";
import { createServerContext, findOwningEntry, invalidateGraph } from "../src/workspace.ts";
import { positionOf } from "./helpers.ts";

const ROOT = "/proj";
const CONFIG_PATH = `${ROOT}/oasis.config.jsonc`;
const ENTRY_PATH = `${ROOT}/openapi.yaml`;
const FRAGMENT_PATH = `${ROOT}/paths/pets.yaml`;

const CONFIG_TEXT = `{ "entries": ["openapi.yaml"] }`;

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
      description: A pet
      properties:
        id:
          type: string
`;

const FRAGMENT_TEXT = `get:
  operationId: listPets
  tags: [pets]
  description: List pets.
  responses:
    '200':
      description: OK
      content:
        application/json:
          schema:
            $ref: '../openapi.yaml#/components/schemas/Pet'
`;

const NON_MEMBER_NON_OPENAPI_PATH = `${ROOT}/notes.yaml`;
const NON_MEMBER_NON_OPENAPI_TEXT = `title: just a plain yaml file\n`;

const NON_MEMBER_OPENAPI_PATH = `${ROOT}/standalone.yaml`;
const NON_MEMBER_OPENAPI_TEXT = `openapi: 3.1.0
info:
  title: Standalone
  version: "1.0.0"
paths: {}
`;

function projectFiles(): Record<string, string> {
  return {
    [CONFIG_PATH]: CONFIG_TEXT,
    [ENTRY_PATH]: ENTRY_TEXT,
    [FRAGMENT_PATH]: FRAGMENT_TEXT,
    [NON_MEMBER_NON_OPENAPI_PATH]: NON_MEMBER_NON_OPENAPI_TEXT,
    [NON_MEMBER_OPENAPI_PATH]: NON_MEMBER_OPENAPI_TEXT,
  };
}

describe("project mode", () => {
  test("loadProjectConfig discovers entries and publishes diagnostics for entry + fragment with nothing open", async () => {
    const ctx = createServerContext(new InMemoryFileSystem(projectFiles()));
    await loadProjectConfig(ctx, [ROOT]);

    expect(ctx.project).toBeDefined();
    expect(ctx.project?.entryPaths).toEqual([ENTRY_PATH]);

    const byFile = await getDiagnosticsByFile(ctx, ENTRY_PATH);
    expect(byFile.has(ENTRY_PATH)).toBe(true);
    expect(byFile.has(FRAGMENT_PATH)).toBe(true);
    // Fragment has no `openapi` key but is a project member: no spurious "missing openapi" noise.
    const fragDiags = byFile.get(FRAGMENT_PATH) ?? [];
    expect(fragDiags.some((d) => d.message.includes('Missing required field "openapi"'))).toBe(false);
  });

  test("fragment file with no openapi key is a project member: definition resolves cross-file to the entry", async () => {
    const ctx = createServerContext(new InMemoryFileSystem(projectFiles()));
    await loadProjectConfig(ctx, [ROOT]);

    const owner = await findOwningEntry(ctx, FRAGMENT_PATH);
    expect(owner).toBe(ENTRY_PATH);

    const position = positionOf(FRAGMENT_TEXT, "../openapi.yaml#/components/schemas/Pet");
    const result = await getDefinition(ctx, { path: FRAGMENT_PATH, position });

    expect(result).toBeDefined();
    expect(result?.targetPath).toBe(ENTRY_PATH);
  });

  test("fragment file $ref completion sees the entry's components", async () => {
    const ctx = createServerContext(new InMemoryFileSystem(projectFiles()));
    await loadProjectConfig(ctx, [ROOT]);

    const position = positionOf(FRAGMENT_TEXT, "../openapi.yaml#/components/schemas/Pet");
    const items = await getCompletions(ctx, { path: FRAGMENT_PATH, position });

    expect(items.some((i) => i.kind === "ref" && i.label.includes("Pet"))).toBe(true);
  });

  test("fragment file: partially typed key on a new line uses the indentation fallback", async () => {
    const ctx = createServerContext(new InMemoryFileSystem(projectFiles()));
    await loadProjectConfig(ctx, [ROOT]);

    const partial = FRAGMENT_TEXT.replace("tags: [pets]", "tags: [pets]\n  sum");
    const files = { ...projectFiles(), [FRAGMENT_PATH]: partial };
    const ctx2 = createServerContext(new InMemoryFileSystem(files));
    await loadProjectConfig(ctx2, [ROOT]);

    const start = positionOf(partial, "sum");
    const position = { line: start.line, character: start.character + "sum".length };
    const items = await getCompletions(ctx2, { path: FRAGMENT_PATH, position });

    const summary = items.find((i) => i.label === "summary");
    expect(summary).toBeDefined();
    expect(summary?.textEdit?.newText).toBe("summary: ");
  });

  test("fragment file: `$ref` mid-typing offers a replacing TextEdit against the owning graph", async () => {
    const partial = FRAGMENT_TEXT.replace(
      "$ref: '../openapi.yaml#/components/schemas/Pet'",
      "$ref: '../openapi",
    );
    const files = { ...projectFiles(), [FRAGMENT_PATH]: partial };
    const ctx = createServerContext(new InMemoryFileSystem(files));
    await loadProjectConfig(ctx, [ROOT]);

    const position = positionOf(partial, "$ref: '../openapi");
    const line = partial.split("\n")[position.line]!;
    const cursor = { line: position.line, character: line.length };
    const items = await getCompletions(ctx, { path: FRAGMENT_PATH, position: cursor });

    const petItem = items.find((i) => i.label.includes("Pet"));
    expect(petItem).toBeDefined();
    expect(petItem?.filterText).toBe(petItem?.label);
    expect(petItem?.textEdit).toBeDefined();
  });

  test("routeDocument: non-member file with no openapi key is ignored", async () => {
    const ctx = createServerContext(new InMemoryFileSystem(projectFiles()));
    await loadProjectConfig(ctx, [ROOT]);

    const route = await routeDocument(ctx, NON_MEMBER_NON_OPENAPI_PATH, NON_MEMBER_NON_OPENAPI_TEXT);
    expect(route.kind).toBe("ignored");
  });

  test("routeDocument: non-member file with an openapi key still lints as its own standalone entry", async () => {
    const ctx = createServerContext(new InMemoryFileSystem(projectFiles()));
    await loadProjectConfig(ctx, [ROOT]);

    const route = await routeDocument(ctx, NON_MEMBER_OPENAPI_PATH, NON_MEMBER_OPENAPI_TEXT);
    expect(route).toEqual({ kind: "standalone", entryPath: NON_MEMBER_OPENAPI_PATH });

    const byFile = await getDiagnosticsByFile(ctx, NON_MEMBER_OPENAPI_PATH);
    expect(byFile.has(NON_MEMBER_OPENAPI_PATH)).toBe(true);
  });

  test("routeDocument: project member routes to its owning entry", async () => {
    const ctx = createServerContext(new InMemoryFileSystem(projectFiles()));
    await loadProjectConfig(ctx, [ROOT]);

    const route = await routeDocument(ctx, FRAGMENT_PATH, FRAGMENT_TEXT);
    expect(route).toEqual({ kind: "project-member", entryPath: ENTRY_PATH });
  });

  test("editing a fragment invalidates and re-lints the owning graph", async () => {
    const fs = new InMemoryFileSystem(projectFiles());
    const ctx = createServerContext(fs);
    await loadProjectConfig(ctx, [ROOT]);

    // Warm the cache once, as a real "publish on startup" pass would.
    await getDiagnosticsByFile(ctx, ENTRY_PATH);

    // Edit: drop operationId from the fragment.
    fs.writeFile(FRAGMENT_PATH, FRAGMENT_TEXT.replace("  operationId: listPets\n", ""));
    invalidateGraph(ctx, FRAGMENT_PATH);

    const owner = await findOwningEntry(ctx, FRAGMENT_PATH);
    expect(owner).toBe(ENTRY_PATH);

    const byFile = await getDiagnosticsByFile(ctx, owner!);
    const fragDiags = byFile.get(FRAGMENT_PATH) ?? [];
    expect(fragDiags.some((d) => d.code === "operation-operationId")).toBe(true);
  });

  test("a file reachable from two entries is owned by the first entry in declaration order", async () => {
    const entryAPath = `${ROOT}/a.yaml`;
    const entryBPath = `${ROOT}/b.yaml`;
    const sharedPath = `${ROOT}/shared.yaml`;
    const files: Record<string, string> = {
      [CONFIG_PATH]: `{ "entries": ["a.yaml", "b.yaml"] }`,
      [entryAPath]: `openapi: 3.1.0\ninfo:\n  title: A\n  version: "1.0.0"\npaths:\n  /a:\n    $ref: './shared.yaml'\n`,
      [entryBPath]: `openapi: 3.1.0\ninfo:\n  title: B\n  version: "1.0.0"\npaths:\n  /b:\n    $ref: './shared.yaml'\n`,
      [sharedPath]: `get:\n  operationId: getShared\n  tags: [shared]\n  description: Shared.\n  responses:\n    '200':\n      description: OK\n`,
    };
    const ctx = createServerContext(new InMemoryFileSystem(files));
    await loadProjectConfig(ctx, [ROOT]);

    expect(ctx.project?.entryPaths).toEqual([entryAPath, entryBPath]);
    const owner = await findOwningEntry(ctx, sharedPath);
    expect(owner).toBe(entryAPath);
  });

  test("a missing entry file is skipped and recorded as a warning, not a crash", async () => {
    const files = projectFiles();
    files[CONFIG_PATH] = `{ "entries": ["openapi.yaml", "does-not-exist.yaml"] }`;
    const ctx = createServerContext(new InMemoryFileSystem(files));
    await loadProjectConfig(ctx, [ROOT]);

    expect(ctx.project?.entryPaths).toEqual([ENTRY_PATH]);
    expect(ctx.project?.warnings.length).toBe(1);
    expect(ctx.project?.warnings[0]).toContain("does-not-exist.yaml");
  });

  test("loadProjectConfig with no entries in the config leaves project mode off", async () => {
    const files = projectFiles();
    files[CONFIG_PATH] = `{}`;
    const ctx = createServerContext(new InMemoryFileSystem(files));
    await loadProjectConfig(ctx, [ROOT]);
    expect(ctx.project).toBeUndefined();
  });
});
