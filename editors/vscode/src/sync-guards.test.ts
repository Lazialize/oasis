import { describe, expect, test } from "bun:test";
import { createDocumentSyncGuards } from "./sync-guards.ts";

type Document = {
  readonly uri: string;
  readonly text: string;
};

type ChangeEvent = { readonly document: Document };

type Notification =
  | { readonly kind: "didOpen"; readonly uri: string; readonly text: string }
  | { readonly kind: "didChange"; readonly uri: string; readonly text: string }
  | { readonly kind: "didClose"; readonly uri: string };

function makeHarness(shouldSync: (document: Document) => boolean) {
  const notifications: Notification[] = [];

  const guards = createDocumentSyncGuards<Document, ChangeEvent>({
    shouldSync,
    getUri: (document) => document.uri,
    sendDidOpen: (document) => {
      notifications.push({ kind: "didOpen", uri: document.uri, text: document.text });
    },
    sendDidClose: (uri) => {
      notifications.push({ kind: "didClose", uri });
    },
  });

  const forwardDidOpen = async (document: Document) => {
    notifications.push({ kind: "didOpen", uri: document.uri, text: document.text });
  };
  const forwardDidChange = async (event: ChangeEvent) => {
    notifications.push({ kind: "didChange", uri: event.document.uri, text: event.document.text });
  };
  const forwardDidClose = async (document: Document) => {
    notifications.push({ kind: "didClose", uri: document.uri });
  };

  return { guards, notifications, forwardDidOpen, forwardDidChange, forwardDidClose };
}

const looksLikeOpenApi = (document: Document) => document.text.includes("openapi:");

describe("document sync guards", () => {
  test("didOpen is suppressed for a document that doesn't look like OpenAPI", async () => {
    const { guards, notifications, forwardDidOpen } = makeHarness(looksLikeOpenApi);
    const document: Document = { uri: "file:///a.yaml", text: "components: {}" };

    await guards.didOpen(document, forwardDidOpen);

    expect(notifications).toEqual([]);
    expect(guards.isSynced(document.uri)).toBe(false);
  });

  test("didOpen forwards and tracks a document that looks like OpenAPI", async () => {
    const { guards, notifications, forwardDidOpen } = makeHarness(looksLikeOpenApi);
    const document: Document = { uri: "file:///a.yaml", text: "openapi: 3.1.0" };

    await guards.didOpen(document, forwardDidOpen);

    expect(notifications).toEqual([{ kind: "didOpen", uri: document.uri, text: document.text }]);
    expect(guards.isSynced(document.uri)).toBe(true);
  });

  test("false -> true didChange sends exactly one full-text didOpen and does not forward the delta", async () => {
    const { guards, notifications, forwardDidOpen, forwardDidChange } = makeHarness(looksLikeOpenApi);
    const uri = "file:///a.yaml";

    // Initial didOpen suppressed: empty document doesn't look like OpenAPI.
    await guards.didOpen({ uri, text: "" }, forwardDidOpen);
    expect(notifications).toEqual([]);
    expect(guards.isSynced(uri)).toBe(false);

    // The user types `openapi: 3.1.0`; the changed document's full text already includes it.
    const event: ChangeEvent = { document: { uri, text: "openapi: 3.1.0" } };
    await guards.didChange(event, forwardDidChange);

    expect(notifications).toEqual([{ kind: "didOpen", uri, text: "openapi: 3.1.0" }]);
    expect(guards.isSynced(uri)).toBe(true);
  });

  test("true -> false didChange sends didClose and clears synced state", async () => {
    const { guards, notifications, forwardDidOpen, forwardDidChange } = makeHarness(looksLikeOpenApi);
    const uri = "file:///a.yaml";

    await guards.didOpen({ uri, text: "openapi: 3.1.0" }, forwardDidOpen);
    notifications.length = 0;

    const event: ChangeEvent = { document: { uri, text: "components: {}" } };
    await guards.didChange(event, forwardDidChange);

    expect(notifications).toEqual([{ kind: "didClose", uri }]);
    expect(guards.isSynced(uri)).toBe(false);
  });

  test("re-adding the root key after a true -> false transition opens clean, without a stale didChange", async () => {
    const { guards, notifications, forwardDidOpen, forwardDidChange } = makeHarness(looksLikeOpenApi);
    const uri = "file:///a.yaml";

    await guards.didOpen({ uri, text: "openapi: 3.1.0" }, forwardDidOpen);
    await guards.didChange({ document: { uri, text: "components: {}" } }, forwardDidChange); // true -> false
    notifications.length = 0;

    await guards.didChange({ document: { uri, text: "openapi: 3.1.0" } }, forwardDidChange); // false -> true again

    expect(notifications).toEqual([{ kind: "didOpen", uri, text: "openapi: 3.1.0" }]);
    expect(guards.isSynced(uri)).toBe(true);
  });

  test("steady-state true -> true didChange forwards the change once, with no synthetic didOpen", async () => {
    const { guards, notifications, forwardDidOpen, forwardDidChange } = makeHarness(looksLikeOpenApi);
    const uri = "file:///a.yaml";

    await guards.didOpen({ uri, text: "openapi: 3.1.0" }, forwardDidOpen);
    notifications.length = 0;

    const event: ChangeEvent = { document: { uri, text: "openapi: 3.1.0\ncomponents: {}" } };
    await guards.didChange(event, forwardDidChange);

    expect(notifications).toEqual([{ kind: "didChange", uri, text: event.document.text }]);
  });

  test("steady-state false -> false didChange forwards nothing", async () => {
    const { guards, notifications, forwardDidChange } = makeHarness(looksLikeOpenApi);
    const uri = "file:///a.yaml";

    await guards.didChange({ document: { uri, text: "components: {}" } }, forwardDidChange);

    expect(notifications).toEqual([]);
    expect(guards.isSynced(uri)).toBe(false);
  });

  test("didClose forwards and untracks a synced document", async () => {
    const { guards, notifications, forwardDidOpen, forwardDidClose } = makeHarness(looksLikeOpenApi);
    const uri = "file:///a.yaml";

    await guards.didOpen({ uri, text: "openapi: 3.1.0" }, forwardDidOpen);
    notifications.length = 0;

    await guards.didClose({ uri, text: "openapi: 3.1.0" }, forwardDidClose);

    expect(notifications).toEqual([{ kind: "didClose", uri }]);
    expect(guards.isSynced(uri)).toBe(false);
  });

  test("didClose is a no-op for an untracked document", async () => {
    const { guards, notifications, forwardDidClose } = makeHarness(looksLikeOpenApi);
    const uri = "file:///a.yaml";

    await guards.didClose({ uri, text: "components: {}" }, forwardDidClose);

    expect(notifications).toEqual([]);
  });

  test("reconcileDocument opens a document that newly matches (e.g. project mode relaxed)", async () => {
    let projectMode = false;
    const { guards, notifications } = makeHarness((document) => projectMode || looksLikeOpenApi(document));
    const document: Document = { uri: "file:///fragment.yaml", text: "components: {}" };

    projectMode = true;
    await guards.reconcileDocument(document);

    expect(notifications).toEqual([{ kind: "didOpen", uri: document.uri, text: document.text }]);
    expect(guards.isSynced(document.uri)).toBe(true);
  });

  test("reconcileDocument closes a document that no longer matches (e.g. project mode disabled)", async () => {
    let projectMode = true;
    const { guards, notifications, forwardDidOpen } = makeHarness((document) => projectMode || looksLikeOpenApi(document));
    const document: Document = { uri: "file:///fragment.yaml", text: "components: {}" };

    await guards.didOpen(document, forwardDidOpen);
    notifications.length = 0;

    projectMode = false;
    await guards.reconcileDocument(document);

    expect(notifications).toEqual([{ kind: "didClose", uri: document.uri }]);
    expect(guards.isSynced(document.uri)).toBe(false);
  });

  test("concurrent didChange calls for the same document are serialized, not interleaved", async () => {
    const order: string[] = [];
    const guards = createDocumentSyncGuards<Document, ChangeEvent>({
      shouldSync: looksLikeOpenApi,
      getUri: (document) => document.uri,
      sendDidOpen: async (document) => {
        order.push(`open-start:${document.text}`);
        await new Promise((resolve) => setTimeout(resolve, 5));
        order.push(`open-end:${document.text}`);
      },
      sendDidClose: async (uri) => {
        order.push(`close:${uri}`);
      },
    });
    const uri = "file:///a.yaml";

    // Two changes racing on the same URI: both trigger a false -> true transition attempt, but
    // only the first should actually flip synced state; the second is a steady-state true -> true
    // forward once the first has settled.
    const forwardDidChange = async () => {
      order.push("forwarded-change");
    };

    await Promise.all([
      guards.didChange({ document: { uri, text: "openapi: 3.1.0" } }, forwardDidChange),
      guards.didChange({ document: { uri, text: "openapi: 3.1.0\nx: 1" } }, forwardDidChange),
    ]);

    // The first task's synthetic open must fully complete before the second task starts.
    const firstEndIndex = order.indexOf("open-end:openapi: 3.1.0");
    const secondStartIndex = order.findIndex((entry, index) => index > firstEndIndex && entry.startsWith("open"));
    expect(firstEndIndex).toBeGreaterThanOrEqual(0);
    expect(secondStartIndex).toBe(-1); // second call sees synced=true already and forwards instead
    expect(order.filter((entry) => entry === "forwarded-change")).toHaveLength(1);
    expect(guards.isSynced(uri)).toBe(true);
  });
});
