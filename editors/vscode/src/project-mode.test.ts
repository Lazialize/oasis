import { describe, expect, test } from "bun:test";
import { refreshProjectMode } from "./project-mode.ts";
import { createDocumentSyncGuards } from "./sync-guards.ts";

type Document = { uri: string; text: string };

describe("workspace-folder project mode", () => {
  test("folder additions and removals reconcile open fragment synchronization", async () => {
    let projectModeActive = false;
    let availableConfigFiles: string[] = [];
    let discoveredConfigFiles: string[] = [];
    const fragment = { uri: "file:///fragment.yaml", text: "components: {}" };
    const notifications: string[] = [];
    const guards = createDocumentSyncGuards<Document, { document: Document }>({
      shouldSync: (document) => projectModeActive || document.text.includes("openapi:"),
      getUri: (document) => document.uri,
      sendDidOpen: (document) => void notifications.push(`open:${document.uri}`),
      sendDidClose: (uri) => void notifications.push(`close:${uri}`),
    });

    const refresh = () =>
      refreshProjectMode({
        isActive: () => projectModeActive,
        detect: async () => {
          discoveredConfigFiles = availableConfigFiles;
          return discoveredConfigFiles.length > 0;
        },
        getConfigFiles: () => discoveredConfigFiles,
        notifyConfigFilesAdded: async (paths) => {
          notifications.push(...paths.map((path) => `config:${path}`));
        },
        setActive: (active) => {
          projectModeActive = active;
        },
        reconcileOpenDocuments: async () => guards.reconcileDocument(fragment),
      });

    availableConfigFiles = ["/workspace/subdir/oasis.config.jsonc"];
    await refresh();
    expect(projectModeActive).toBe(true);
    expect(notifications).toEqual(["config:/workspace/subdir/oasis.config.jsonc", `open:${fragment.uri}`]);
    expect(guards.isSynced(fragment.uri)).toBe(true);

    // A second nested config is forwarded even though project mode is already active and no
    // document reconciliation is needed for this steady-state predicate.
    availableConfigFiles = ["/workspace/subdir/oasis.config.jsonc", "/workspace/other/oasis.config.jsonc"];
    await refresh();
    expect(notifications).toEqual([
      "config:/workspace/subdir/oasis.config.jsonc",
      `open:${fragment.uri}`,
      "config:/workspace/other/oasis.config.jsonc",
    ]);

    availableConfigFiles = [];
    await refresh();
    expect(projectModeActive).toBe(false);
    expect(notifications).toEqual([
      "config:/workspace/subdir/oasis.config.jsonc",
      `open:${fragment.uri}`,
      "config:/workspace/other/oasis.config.jsonc",
      `close:${fragment.uri}`,
    ]);
    expect(guards.isSynced(fragment.uri)).toBe(false);
  });
});
