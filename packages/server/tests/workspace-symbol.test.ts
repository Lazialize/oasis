import { describe, expect, test } from "bun:test";
import { InMemoryFileSystem } from "@oasis/core";
import { getWorkspaceSymbols } from "../src/handlers/workspace-symbol.ts";
import { scanWorkspaceRootsForProjects } from "../src/project.ts";
import { createServerContext, getGraph, invalidateGraph } from "../src/workspace.ts";

const ROOT_A = "/w/projA";
const ROOT_B = "/w/projB";
const ENTRY_A_PATH = `${ROOT_A}/openapi.yaml`;
const ENTRY_B_PATH = `${ROOT_B}/openapi.yaml`;
// Shared components fragment loaded (via $ref) from both projects' entries, to exercise dedup.
const SHARED_PATH = "/w/shared/common.yaml";
const STANDALONE_PATH = "/w/standalone.yaml";

const CONFIG_A_TEXT = `{ "entries": ["openapi.yaml"] }`;
const CONFIG_B_TEXT = `{ "entries": ["openapi.yaml"] }`;

const ENTRY_A_TEXT = `openapi: 3.1.0
info:
  title: API A
  version: "1.0.0"
paths:
  /pets:
    get:
      operationId: listPets
      responses:
        '200':
          description: OK
webhooks:
  petCreated:
    post:
      operationId: onPetCreated
      responses:
        '200':
          description: OK
components:
  schemas:
    PetA:
      type: object
    SharedRef:
      $ref: '../shared/common.yaml#/components/schemas/Shared'
  parameters:
    LimitParam:
      name: limit
      in: query
      schema:
        type: integer
  responses:
    PetResponse:
      description: A pet
  securitySchemes:
    ApiKey:
      type: apiKey
      name: X-API-Key
      in: header
  pathItems:
    PetsItem:
      get:
        operationId: unused
        responses:
          '200':
            description: OK
`;

const ENTRY_B_TEXT = `openapi: 3.1.0
info:
  title: API B
  version: "1.0.0"
paths: {}
components:
  schemas:
    PetB:
      type: object
    SharedRef:
      $ref: '../shared/common.yaml#/components/schemas/Shared'
`;

const SHARED_TEXT = `components:
  schemas:
    Shared:
      type: object
`;

const STANDALONE_TEXT = `openapi: 3.1.0
info:
  title: Standalone
  version: "1.0.0"
paths:
  /widgets:
    get:
      operationId: listWidgets
      responses:
        '200':
          description: OK
components:
  schemas:
    Widget:
      type: object
`;

function files(): Record<string, string> {
  return {
    [`${ROOT_A}/oasis.config.jsonc`]: CONFIG_A_TEXT,
    [`${ROOT_B}/oasis.config.jsonc`]: CONFIG_B_TEXT,
    [ENTRY_A_PATH]: ENTRY_A_TEXT,
    [ENTRY_B_PATH]: ENTRY_B_TEXT,
    [SHARED_PATH]: SHARED_TEXT,
    [STANDALONE_PATH]: STANDALONE_TEXT,
  };
}

/** Two projects (both $ref-ing into the same shared components fragment) plus one open standalone
 * document, with every graph warmed into `ctx.graphCache` the way the real server does at startup
 * / on document open. */
async function contextWithEverythingLoaded() {
  const ctx = createServerContext(new InMemoryFileSystem(files()));
  await scanWorkspaceRootsForProjects(ctx, [ROOT_A, ROOT_B]);
  await getGraph(ctx, ENTRY_A_PATH);
  await getGraph(ctx, ENTRY_B_PATH);
  await getGraph(ctx, STANDALONE_PATH);
  return ctx;
}

describe("getWorkspaceSymbols", () => {
  test("empty query returns symbols from every loaded graph, including operations and standalone documents", async () => {
    const ctx = await contextWithEverythingLoaded();

    const results = await getWorkspaceSymbols(ctx, "");
    const names = results.map((r) => r.name);

    expect(names).toContain("PetA");
    expect(names).toContain("PetB");
    expect(names).toContain("Widget");
    expect(names).toContain("listPets"); // operation defined directly in the entry's paths
    expect(names).toContain("listWidgets"); // operation from the standalone document
    expect(names).toContain("onPetCreated"); // webhook operation
  });

  test("component kinds are mapped per section", async () => {
    const ctx = await contextWithEverythingLoaded();
    const results = await getWorkspaceSymbols(ctx, "");
    const byName = (name: string) => results.find((r) => r.name === name)!;

    expect(byName("PetA").kind).toBe("class");
    expect(byName("PetA").containerName).toBe("components/schemas");
    expect(byName("LimitParam").kind).toBe("variable");
    expect(byName("PetResponse").kind).toBe("interface");
    expect(byName("ApiKey").kind).toBe("key");
    expect(byName("PetsItem").kind).toBe("object"); // 3.1 pathItems: no dedicated mapping
    expect(byName("PetsItem").containerName).toBe("components/pathItems");
  });

  test("operation symbols use operationId as name and the path template / webhook key as containerName", async () => {
    const ctx = await contextWithEverythingLoaded();
    const results = await getWorkspaceSymbols(ctx, "");

    const listWidgets = results.find((r) => r.name === "listWidgets")!;
    expect(listWidgets.kind).toBe("method");
    expect(listWidgets.containerName).toBe("/widgets");

    const webhookOp = results.find((r) => r.name === "onPetCreated")!;
    expect(webhookOp.kind).toBe("method");
    expect(webhookOp.containerName).toBe("petCreated");
  });

  test("a document reachable from more than one graph contributes its symbols only once", async () => {
    const ctx = await contextWithEverythingLoaded();
    const results = await getWorkspaceSymbols(ctx, "");

    // "Shared" is defined once (in the fragment loaded by both project A and B), not per-graph.
    expect(results.filter((r) => r.name === "Shared")).toHaveLength(1);
  });

  test("query filters case-insensitively by substring", async () => {
    const ctx = await contextWithEverythingLoaded();

    const results = await getWorkspaceSymbols(ctx, "pet");
    const names = results.map((r) => r.name).sort();

    expect(names).toEqual(["PetA", "PetB", "PetResponse", "PetsItem", "listPets", "onPetCreated"].sort());
  });

  test("empty projects/graphCache yields no symbols", async () => {
    const ctx = createServerContext(new InMemoryFileSystem({}));
    expect(await getWorkspaceSymbols(ctx, "")).toEqual([]);
  });

  // Regression test for finding 4: `invalidateGraph` (called e.g. from `connection.ts`'s
  // `onDidClose` for an unrelated document) evicts a whole project's graph from `ctx.graphCache`
  // with no refill. Workspace symbols used to silently omit that project until some unrelated
  // edit happened to rebuild its graph; `getWorkspaceSymbols` must now lazily refill any loaded
  // project's graph that's missing from the cache before walking it.
  test("finding 4: a project whose graph was evicted from the cache is lazily refilled, not omitted", async () => {
    const ctx = await contextWithEverythingLoaded();

    // Simulate `onDidClose` evicting project A's graph (e.g. closing some unrelated open buffer
    // that happened to be a member of it), without anything reopening/re-warming it afterward.
    invalidateGraph(ctx, ENTRY_A_PATH);
    expect(ctx.graphCache.has(ENTRY_A_PATH)).toBe(false);

    const results = await getWorkspaceSymbols(ctx, "");
    const names = results.map((r) => r.name);
    expect(names).toContain("PetA");
    expect(names).toContain("listPets");
    // The refill also re-populates the cache for subsequent callers (definition/hover/etc.).
    expect(ctx.graphCache.has(ENTRY_A_PATH)).toBe(true);
  });

  // Regression test for finding 5: the old hand-rolled `collectOperations` walked each document's
  // own `paths`/`webhooks` map directly, so an operation reached only through a $ref'd path item
  // (a whole path item behind `$ref`, not just the fragment loaded via a plain path entry) never
  // surfaced. Using `@oasis/linter`'s `iterateOperations` (which resolves $ref'd path items) fixes
  // this, and attributes the symbol to the file the operation actually lives in.
  test("finding 5: an operation behind a $ref'd path item (not just a $ref'd fragment) is found", async () => {
    const root = "/w/refPathItem";
    const entryPath = `${root}/openapi.yaml`;
    const fragmentPath = `${root}/paths/widgets.yaml`;
    const entryText = `openapi: 3.1.0
info:
  title: Ref Path Item
  version: "1.0.0"
paths:
  /widgets:
    $ref: './paths/widgets.yaml'
`;
    const fragmentText = `get:
  operationId: listWidgetsViaRefPathItem
  responses:
    '200':
      description: OK
`;
    const ctx = createServerContext(new InMemoryFileSystem({ [entryPath]: entryText, [fragmentPath]: fragmentText }));
    await getGraph(ctx, entryPath);

    const results = await getWorkspaceSymbols(ctx, "");
    const op = results.find((r) => r.name === "listWidgetsViaRefPathItem");
    expect(op).toBeDefined();
    expect(op?.kind).toBe("method");
    expect(op?.containerName).toBe("/widgets"); // the path template, not the fragment's own key
    expect(op?.filePath).toBe(fragmentPath); // attributed to the file it actually lives in
  });

  // Regression test for the range-overshoot fix (shared `nodeRange` helper in `yaml-helpers.ts`
  // now uses `range[1]`, the end of the node's own content, instead of `range[2]`, which also
  // covers trailing whitespace/comments up to the next sibling).
  test("symbol ranges end at the node's own content, not at trailing whitespace/comments before the next sibling", async () => {
    const path = "/w/rangeCheck/openapi.yaml";
    const text = `openapi: 3.1.0
info:
  title: Range Check
  version: "1.0.0"
paths: {}
components:
  schemas:
    Pet:
      type: object

    # a comment that belongs to nobody in particular
    Owner:
      type: object
`;
    const ctx = createServerContext(new InMemoryFileSystem({ [path]: text }));
    await getGraph(ctx, path);

    const results = await getWorkspaceSymbols(ctx, "");
    const pet = results.find((r) => r.name === "Pet")!;
    const petSlice = text.slice(pet.range.startOffset, pet.range.endOffset);
    expect(petSlice.trim()).toBe("type: object");
    expect(petSlice.includes("comment")).toBe(false);
  });
});
