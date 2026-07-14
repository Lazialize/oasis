import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryFileSystem } from "@oasis/core";
import { getDiagnosticsByFile } from "../src/diagnostics.ts";
import { routeDocument } from "../src/document-routing.ts";
import { getCodeActions } from "../src/handlers/code-actions.ts";
import { getCompletions } from "../src/handlers/completion.ts";
import { getDefinition } from "../src/handlers/definition.ts";
import {
  discoverProjectUpward,
  isConfigFilePath,
  loadConfigFilesFromInit,
  loadProjectAtPath,
  scanWorkspaceRootsForProjects,
} from "../src/project.ts";
import { createServerContext, findOwningEntry, invalidateGraph } from "../src/workspace.ts";
import { positionOf } from "./helpers.ts";
import {
  ENTRY_A_PATH as MULTI_ENTRY_A_PATH,
  ROOT as MULTI_ROOT,
  SHARED_PATH as MULTI_SHARED_PATH,
  SHARED_TWO_COMPONENTS_TEXT,
  siblingUsageFiles,
} from "./multi-entry-fixtures.ts";

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
    await scanWorkspaceRootsForProjects(ctx, [ROOT]);

    expect(ctx.projects.get(CONFIG_PATH)).toBeDefined();
    expect(ctx.projects.get(CONFIG_PATH)?.entryPaths).toEqual([ENTRY_PATH]);

    const byFile = await getDiagnosticsByFile(ctx, ENTRY_PATH);
    expect(byFile.has(ENTRY_PATH)).toBe(true);
    expect(byFile.has(FRAGMENT_PATH)).toBe(true);
    // Fragment has no `openapi` key but is a project member: no spurious "missing openapi" noise.
    const fragDiags = byFile.get(FRAGMENT_PATH) ?? [];
    expect(fragDiags.some((d) => d.message.includes('Missing required field "openapi"'))).toBe(false);
  });

  test("config entry paths keep literal percent characters", async () => {
    const percentEntryPath = `${ROOT}/api%20v1.yaml`;
    const files = {
      [CONFIG_PATH]: `{ "entries": ["api%20v1.yaml"] }`,
      [percentEntryPath]: "openapi: 3.1.0\ninfo: { title: Percent, version: '1' }\npaths: {}\n",
    };
    const ctx = createServerContext(new InMemoryFileSystem(files));

    await scanWorkspaceRootsForProjects(ctx, [ROOT]);

    expect(ctx.projects.get(CONFIG_PATH)?.entryPaths).toEqual([percentEntryPath]);
    expect(ctx.projects.get(CONFIG_PATH)?.warnings).toEqual([]);
  });

  test("fragment file with no openapi key is a project member: definition resolves cross-file to the entry", async () => {
    const ctx = createServerContext(new InMemoryFileSystem(projectFiles()));
    await scanWorkspaceRootsForProjects(ctx, [ROOT]);

    const owner = await findOwningEntry(ctx, FRAGMENT_PATH);
    expect(owner).toBe(ENTRY_PATH);

    const position = positionOf(FRAGMENT_TEXT, "../openapi.yaml#/components/schemas/Pet");
    const result = await getDefinition(ctx, { path: FRAGMENT_PATH, position });

    expect(result).toBeDefined();
    expect(result?.targetPath).toBe(ENTRY_PATH);
  });

  test("fragment file $ref completion sees the entry's components", async () => {
    const ctx = createServerContext(new InMemoryFileSystem(projectFiles()));
    await scanWorkspaceRootsForProjects(ctx, [ROOT]);

    const position = positionOf(FRAGMENT_TEXT, "../openapi.yaml#/components/schemas/Pet");
    const items = await getCompletions(ctx, { path: FRAGMENT_PATH, position });

    expect(items.some((i) => i.kind === "ref" && i.label.includes("Pet"))).toBe(true);
  });

  test("fragment file: partially typed key on a new line uses the indentation fallback", async () => {
    const ctx = createServerContext(new InMemoryFileSystem(projectFiles()));
    await scanWorkspaceRootsForProjects(ctx, [ROOT]);

    const partial = FRAGMENT_TEXT.replace("tags: [pets]", "tags: [pets]\n  sum");
    const files = { ...projectFiles(), [FRAGMENT_PATH]: partial };
    const ctx2 = createServerContext(new InMemoryFileSystem(files));
    await scanWorkspaceRootsForProjects(ctx2, [ROOT]);

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
    await scanWorkspaceRootsForProjects(ctx, [ROOT]);

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
    await scanWorkspaceRootsForProjects(ctx, [ROOT]);

    const route = await routeDocument(ctx, NON_MEMBER_NON_OPENAPI_PATH, NON_MEMBER_NON_OPENAPI_TEXT);
    expect(route.kind).toBe("ignored");
  });

  test("routeDocument: non-member file with an openapi key still lints as its own standalone entry", async () => {
    const ctx = createServerContext(new InMemoryFileSystem(projectFiles()));
    await scanWorkspaceRootsForProjects(ctx, [ROOT]);

    const route = await routeDocument(ctx, NON_MEMBER_OPENAPI_PATH, NON_MEMBER_OPENAPI_TEXT);
    expect(route).toEqual({ kind: "standalone", entryPath: NON_MEMBER_OPENAPI_PATH });

    const byFile = await getDiagnosticsByFile(ctx, NON_MEMBER_OPENAPI_PATH);
    expect(byFile.has(NON_MEMBER_OPENAPI_PATH)).toBe(true);
  });

  test("routeDocument: project member routes to its owning entry", async () => {
    const ctx = createServerContext(new InMemoryFileSystem(projectFiles()));
    await scanWorkspaceRootsForProjects(ctx, [ROOT]);

    const route = await routeDocument(ctx, FRAGMENT_PATH, FRAGMENT_TEXT);
    expect(route).toEqual({ kind: "project-member", entryPath: ENTRY_PATH });
  });

  test("editing a fragment invalidates and re-lints the owning graph", async () => {
    const fs = new InMemoryFileSystem(projectFiles());
    const ctx = createServerContext(fs);
    await scanWorkspaceRootsForProjects(ctx, [ROOT]);

    // Warm the cache once, as a real "publish on startup" pass would.
    await getDiagnosticsByFile(ctx, ENTRY_PATH);

    // Edit: drop operationId from the fragment.
    fs.writeFile(FRAGMENT_PATH, FRAGMENT_TEXT.replace("  operationId: listPets\n", ""));
    invalidateGraph(ctx, FRAGMENT_PATH);

    const owner = await findOwningEntry(ctx, FRAGMENT_PATH);
    expect(owner).toBe(ENTRY_PATH);

    const byFile = await getDiagnosticsByFile(ctx, owner!);
    const fragDiags = byFile.get(FRAGMENT_PATH) ?? [];
    expect(fragDiags.some((d) => d.code === "operation/operation-id")).toBe(true);
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
    await scanWorkspaceRootsForProjects(ctx, [ROOT]);

    expect(ctx.projects.get(CONFIG_PATH)?.entryPaths).toEqual([entryAPath, entryBPath]);
    const owner = await findOwningEntry(ctx, sharedPath);
    expect(owner).toBe(entryAPath);
  });

  test("a missing entry file is skipped and recorded as a warning, not a crash", async () => {
    const files = projectFiles();
    files[CONFIG_PATH] = `{ "entries": ["openapi.yaml", "does-not-exist.yaml"] }`;
    const ctx = createServerContext(new InMemoryFileSystem(files));
    await scanWorkspaceRootsForProjects(ctx, [ROOT]);

    expect(ctx.projects.get(CONFIG_PATH)?.entryPaths).toEqual([ENTRY_PATH]);
    expect(ctx.projects.get(CONFIG_PATH)?.warnings.length).toBe(1);
    expect(ctx.projects.get(CONFIG_PATH)?.warnings[0]).toContain("does-not-exist.yaml");
  });

  // Glob entries are expanded against the real filesystem (the overlay FileSystem interface
  // can't enumerate directories), so these tests use a real temp directory. The config file's
  // own content is still read through ctx.fileSystem (here, in-memory keyed by the real path).
  describe("glob entries", () => {
    const entryText = (title: string): string =>
      `openapi: 3.1.0\ninfo:\n  title: ${title}\n  version: "1.0.0"\npaths: {}\n`;

    function makeGlobProjectDir(): { root: string; configPath: string; entryA: string; entryB: string } {
      const root = mkdtempSync(join(tmpdir(), "oasis-server-glob-"));
      mkdirSync(join(root, "apis", "a"), { recursive: true });
      mkdirSync(join(root, "apis", "b"), { recursive: true });
      const entryA = join(root, "apis", "a", "openapi.yaml");
      const entryB = join(root, "apis", "b", "openapi.yaml");
      writeFileSync(entryA, entryText("A"));
      writeFileSync(entryB, entryText("B"));
      return { root, configPath: join(root, "oasis.config.jsonc"), entryA, entryB };
    }

    test("a glob entry expands to every matching file on disk", async () => {
      const { configPath, entryA, entryB } = makeGlobProjectDir();
      const ctx = createServerContext(
        new InMemoryFileSystem({ [configPath]: `{ "entries": ["apis/*/openapi.yaml"] }` }),
      );
      await loadProjectAtPath(ctx, configPath);

      expect(ctx.projects.get(configPath)?.entryPaths).toEqual([entryA, entryB]);
      expect(ctx.projects.get(configPath)?.warnings).toEqual([]);
    });

    test("reloading the project after a new file appears re-expands the glob", async () => {
      const { root, configPath, entryA, entryB } = makeGlobProjectDir();
      const ctx = createServerContext(
        new InMemoryFileSystem({ [configPath]: `{ "entries": ["apis/*/openapi.yaml"] }` }),
      );
      await loadProjectAtPath(ctx, configPath);
      expect(ctx.projects.get(configPath)?.entryPaths).toEqual([entryA, entryB]);

      mkdirSync(join(root, "apis", "c"), { recursive: true });
      const entryC = join(root, "apis", "c", "openapi.yaml");
      writeFileSync(entryC, entryText("C"));
      await loadProjectAtPath(ctx, configPath);

      expect(ctx.projects.get(configPath)?.entryPaths).toEqual([entryA, entryB, entryC]);
    });

    test("a glob matching nothing records a warning; a literal entry overlapping a glob is deduped", async () => {
      const { configPath, entryA, entryB } = makeGlobProjectDir();
      const ctx = createServerContext(
        new InMemoryFileSystem({
          [configPath]: `{ "entries": ["apis/a/openapi.yaml", "apis/*/openapi.yaml", "nowhere/*.yaml"] }`,
          [entryA]: entryText("A"),
        }),
      );
      await loadProjectAtPath(ctx, configPath);

      expect(ctx.projects.get(configPath)?.entryPaths).toEqual([entryA, entryB]);
      expect(ctx.projects.get(configPath)?.warnings.length).toBe(1);
      expect(ctx.projects.get(configPath)?.warnings[0]).toContain("nowhere/*.yaml");
    });
  });

  test("components/no-unused does not flag a shared component that only a sibling entry uses", async () => {
    const ctx = createServerContext(new InMemoryFileSystem(siblingUsageFiles()));
    await scanWorkspaceRootsForProjects(ctx, [MULTI_ROOT]);

    // Lint entry A's graph. `shared.yaml` is in it (A references `Common`), but `Pet` is used only
    // by the sibling entry B. It must not be reported unused.
    const byFile = await getDiagnosticsByFile(ctx, MULTI_ENTRY_A_PATH);

    const sharedDiags = byFile.get(MULTI_SHARED_PATH) ?? [];
    const unused = sharedDiags.filter((d) => d.code === "components/no-unused");
    expect(unused).toEqual([]);
  });

  test("remove-unused quickfix is not offered for a component a sibling entry references", async () => {
    const ctx = createServerContext(new InMemoryFileSystem(siblingUsageFiles()));
    await scanWorkspaceRootsForProjects(ctx, [MULTI_ROOT]);

    // Simulate a (stale/single-graph) components/no-unused diagnostic on `Pet` in shared.yaml and
    // ask for code actions: the cross-graph guard must suppress the destructive delete.
    const petLine = SHARED_TWO_COMPONENTS_TEXT.split("\n").findIndex((l) => l.trim() === "Pet:");
    const bodyStart = { line: petLine + 1, character: 6 };
    const bodyEnd = { line: petLine + 6, character: 0 };
    const diag = {
      code: "components/no-unused",
      message: 'Component "Pet" in "components/schemas" is not used anywhere in the workspace.',
      range: { start: bodyStart, end: bodyEnd },
    };

    const actions = await getCodeActions(ctx, {
      path: MULTI_SHARED_PATH,
      position: { line: petLine, character: 4 },
      diagnostics: [diag],
    });

    expect(actions.some((a) => a.title.startsWith("Remove unused component"))).toBe(false);
  });

  test("loadProjectConfig with no entries in the config leaves project mode off", async () => {
    const files = projectFiles();
    files[CONFIG_PATH] = `{}`;
    const ctx = createServerContext(new InMemoryFileSystem(files));
    await scanWorkspaceRootsForProjects(ctx, [ROOT]);
    expect(ctx.projects.has(CONFIG_PATH)).toBe(false);
  });
});

describe("isConfigFilePath", () => {
  test("matches a POSIX-style path", () => {
    expect(isConfigFilePath("/proj/oasis.config.jsonc")).toBe(true);
  });

  test("matches a Windows-style path (backslash separators, as produced by URI.fsPath on Windows)", () => {
    expect(isConfigFilePath("C:\\proj\\oasis.config.jsonc")).toBe(true);
  });

  test("matches the bare filename with no directory", () => {
    expect(isConfigFilePath("oasis.config.jsonc")).toBe(true);
  });

  test("does not match a file that merely ends with the config name as a substring", () => {
    expect(isConfigFilePath("/proj/not-oasis.config.jsonc")).toBe(false);
  });

  test("does not match an unrelated file", () => {
    expect(isConfigFilePath("/proj/openapi.yaml")).toBe(false);
    expect(isConfigFilePath("C:\\proj\\openapi.yaml")).toBe(false);
  });
});

describe("subdirectory config discovery", () => {
  const SUB_DIR = `${ROOT}/examples/petstore`;
  const SUB_CONFIG_PATH = `${SUB_DIR}/oasis.config.jsonc`;
  const SUB_ENTRY_PATH = `${SUB_DIR}/openapi.yaml`;
  const SUB_FRAGMENT_PATH = `${SUB_DIR}/paths/pets.yaml`;

  const SUB_ENTRY_TEXT = `openapi: 3.1.0
info:
  title: Sub API
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

  const SUB_FRAGMENT_TEXT = `get:
  operationId: listPets
  tags: [pets]
  description: List pets.
  responses:
    '200':
      description: OK
`;

  function subprojectFiles(): Record<string, string> {
    return {
      [SUB_CONFIG_PATH]: `{ "entries": ["openapi.yaml"] }`,
      [SUB_ENTRY_PATH]: SUB_ENTRY_TEXT,
      [SUB_FRAGMENT_PATH]: SUB_FRAGMENT_TEXT,
    };
  }

  test("routeDocument discovers a subdirectory config upward on didOpen of a fragment file, without any prior eager load", async () => {
    const ctx = createServerContext(new InMemoryFileSystem(subprojectFiles()));
    ctx.workspaceRoots = [ROOT];

    expect(ctx.projects.size).toBe(0);

    const route = await routeDocument(ctx, SUB_FRAGMENT_PATH, SUB_FRAGMENT_TEXT);

    expect(route).toEqual({ kind: "project-member", entryPath: SUB_ENTRY_PATH });
    expect(ctx.projects.has(SUB_CONFIG_PATH)).toBe(true);
  });

  test("discoverProjectUpward stops at the workspace folder root and doesn't discover configs above it", async () => {
    const OUTER_CONFIG_PATH = `${ROOT}/oasis.config.jsonc`;
    const files = { ...subprojectFiles(), [OUTER_CONFIG_PATH]: `{ "entries": ["does-not-matter.yaml"] }` };
    const ctx = createServerContext(new InMemoryFileSystem(files));
    // Workspace root is the subdirectory itself: the outer config (a sibling of ROOT's ancestor)
    // is out of bounds and must not be discovered.
    ctx.workspaceRoots = [SUB_DIR];

    const discovered = await discoverProjectUpward(ctx, SUB_FRAGMENT_PATH);
    expect(discovered).toBe(true);
    expect(ctx.projects.has(SUB_CONFIG_PATH)).toBe(true);
    expect(ctx.projects.has(OUTER_CONFIG_PATH)).toBe(false);
  });

  test("initializationOptions.configFiles eagerly loads a subdirectory project and publishes diagnostics with nothing open", async () => {
    const ctx = createServerContext(new InMemoryFileSystem(subprojectFiles()));
    await loadConfigFilesFromInit(ctx, [SUB_CONFIG_PATH]);

    expect(ctx.projects.get(SUB_CONFIG_PATH)?.entryPaths).toEqual([SUB_ENTRY_PATH]);

    const byFile = await getDiagnosticsByFile(ctx, SUB_ENTRY_PATH);
    expect(byFile.has(SUB_ENTRY_PATH)).toBe(true);
    expect(byFile.has(SUB_FRAGMENT_PATH)).toBe(true);
  });

  test("two configs in sibling subdirectories load as two independent projects with correct membership", async () => {
    const dirA = `${ROOT}/services/a`;
    const dirB = `${ROOT}/services/b`;
    const configA = `${dirA}/oasis.config.jsonc`;
    const configB = `${dirB}/oasis.config.jsonc`;
    const entryA = `${dirA}/openapi.yaml`;
    const entryB = `${dirB}/openapi.yaml`;
    const files: Record<string, string> = {
      [configA]: `{ "entries": ["openapi.yaml"] }`,
      [entryA]: `openapi: 3.1.0\ninfo:\n  title: A\n  version: "1.0.0"\npaths: {}\n`,
      [configB]: `{ "entries": ["openapi.yaml"] }`,
      [entryB]: `openapi: 3.1.0\ninfo:\n  title: B\n  version: "1.0.0"\npaths: {}\n`,
    };
    const ctx = createServerContext(new InMemoryFileSystem(files));
    await loadConfigFilesFromInit(ctx, [configA, configB]);

    expect(ctx.projects.size).toBe(2);

    const ownerA = await findOwningEntry(ctx, entryA);
    const ownerB = await findOwningEntry(ctx, entryB);
    expect(ownerA).toBe(entryA);
    expect(ownerB).toBe(entryB);
  });

  test("dedupe: root-of-workspace scan and initializationOptions.configFiles reporting the same config load a single project", async () => {
    const ctx = createServerContext(new InMemoryFileSystem(projectFiles()));

    await scanWorkspaceRootsForProjects(ctx, [ROOT]);
    await loadConfigFilesFromInit(ctx, [CONFIG_PATH]);

    expect(ctx.projects.size).toBe(1);
    expect(ctx.projects.get(CONFIG_PATH)?.entryPaths).toEqual([ENTRY_PATH]);
  });

  test("editing a config file reloads only its own project, leaving a sibling project untouched", async () => {
    const dirA = `${ROOT}/services/a`;
    const dirB = `${ROOT}/services/b`;
    const configA = `${dirA}/oasis.config.jsonc`;
    const configB = `${dirB}/oasis.config.jsonc`;
    const entryA = `${dirA}/openapi.yaml`;
    const entryA2 = `${dirA}/openapi-v2.yaml`;
    const entryB = `${dirB}/openapi.yaml`;
    const entryText = (title: string): string =>
      `openapi: 3.1.0\ninfo:\n  title: ${title}\n  version: "1.0.0"\npaths: {}\n`;
    const fs = new InMemoryFileSystem({
      [configA]: `{ "entries": ["openapi.yaml"] }`,
      [entryA]: entryText("A"),
      [entryA2]: entryText("A2"),
      [configB]: `{ "entries": ["openapi.yaml"] }`,
      [entryB]: entryText("B"),
    });
    const ctx = createServerContext(fs);
    await loadConfigFilesFromInit(ctx, [configA, configB]);

    const beforeB = ctx.projects.get(configB);
    expect(beforeB?.entryPaths).toEqual([entryB]);

    // Add a second entry to project A's config and reload just that project.
    fs.writeFile(configA, `{ "entries": ["openapi.yaml", "openapi-v2.yaml"] }`);
    await loadProjectAtPath(ctx, configA);

    expect(ctx.projects.get(configA)?.entryPaths).toEqual([entryA, entryA2]);
    // Project B's state is unaffected by A's reload.
    expect(ctx.projects.get(configB)).toEqual(beforeB);
  });

  test("deleting a config file unloads its project", async () => {
    const fs = new InMemoryFileSystem(subprojectFiles());
    const ctx = createServerContext(fs);
    await loadProjectAtPath(ctx, SUB_CONFIG_PATH);
    expect(ctx.projects.has(SUB_CONFIG_PATH)).toBe(true);

    fs.deleteFile(SUB_CONFIG_PATH);
    await loadProjectAtPath(ctx, SUB_CONFIG_PATH);

    expect(ctx.projects.has(SUB_CONFIG_PATH)).toBe(false);
    const owner = await findOwningEntry(ctx, SUB_FRAGMENT_PATH);
    expect(owner).toBeUndefined();
  });
});
