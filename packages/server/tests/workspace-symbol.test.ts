import { describe, expect, test } from "bun:test";
import { InMemoryFileSystem } from "@oasis/core";
import { getWorkspaceSymbols } from "../src/handlers/workspace-symbol.ts";
import { scanWorkspaceRootsForProjects } from "../src/project.ts";
import { createServerContext, getGraph } from "../src/workspace.ts";

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

    const results = getWorkspaceSymbols(ctx, "");
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
    const results = getWorkspaceSymbols(ctx, "");
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
    const results = getWorkspaceSymbols(ctx, "");

    const listWidgets = results.find((r) => r.name === "listWidgets")!;
    expect(listWidgets.kind).toBe("method");
    expect(listWidgets.containerName).toBe("/widgets");

    const webhookOp = results.find((r) => r.name === "onPetCreated")!;
    expect(webhookOp.kind).toBe("method");
    expect(webhookOp.containerName).toBe("petCreated");
  });

  test("a document reachable from more than one graph contributes its symbols only once", async () => {
    const ctx = await contextWithEverythingLoaded();
    const results = getWorkspaceSymbols(ctx, "");

    // "Shared" is defined once (in the fragment loaded by both project A and B), not per-graph.
    expect(results.filter((r) => r.name === "Shared")).toHaveLength(1);
  });

  test("query filters case-insensitively by substring", async () => {
    const ctx = await contextWithEverythingLoaded();

    const results = getWorkspaceSymbols(ctx, "pet");
    const names = results.map((r) => r.name).sort();

    expect(names).toEqual(["PetA", "PetB", "PetResponse", "PetsItem", "listPets", "onPetCreated"].sort());
  });

  test("empty projects/graphCache yields no symbols", () => {
    const ctx = createServerContext(new InMemoryFileSystem({}));
    expect(getWorkspaceSymbols(ctx, "")).toEqual([]);
  });
});
