/**
 * Client-side document synchronization state machine for the `shouldSync` guard (see the big
 * comment block at the top of extension.ts for why this guard exists).
 *
 * A document's membership can flip in either direction while it's already open:
 *  - false -> true: e.g. the user types an `openapi:` key into a brand-new buffer whose initial
 *    `didOpen` was suppressed.
 *  - true -> false: e.g. the user deletes the root `openapi` key from a previously-synced
 *    document.
 *
 * Both transitions must be handled with exactly one notification and no double-forwarding
 * (issue #112):
 *  - false -> true must send a single full-text `didOpen` and must NOT also forward the
 *    triggering `didChange` delta, because the full text already includes that edit.
 *  - true -> false must send `didClose` and drop the URI from the synced set so a later
 *    false -> true transition starts clean (a fresh full-text `didOpen`, not a delta against a
 *    server buffer that no longer exists).
 *
 * All work for a given URI — whether triggered by middleware traffic (didOpen/didChange/didClose)
 * or by external reconciliation (`reconcileDocument`, used when `projectModeActive` flips or a
 * config file is discovered/removed, issue #58) — is serialized through a per-URI queue so that,
 * for example, a `didChange` racing a project-mode reconciliation for the same document can never
 * interleave and produce a duplicate or missing notification.
 */

export type DocumentSyncDeps<Document> = {
  /** Whether `document` should currently be synced to the server. */
  shouldSync: (document: Document) => boolean;
  /** Stable identity for a document (`document.uri.toString()`). */
  getUri: (document: Document) => string;
  /** Send a synthetic full-text `textDocument/didOpen` for `document`. */
  sendDidOpen: (document: Document) => void | PromiseLike<void>;
  /** Send `textDocument/didClose` for the document identified by `uri`. */
  sendDidClose: (uri: string) => void | PromiseLike<void>;
};

export type DocumentSyncGuards<Document, ChangeEvent extends { document: Document }> = {
  didOpen: (document: Document, next: (document: Document) => void | PromiseLike<void>) => Promise<void>;
  didChange: (event: ChangeEvent, next: (event: ChangeEvent) => void | PromiseLike<void>) => Promise<void>;
  didClose: (document: Document, next: (document: Document) => void | PromiseLike<void>) => Promise<void>;
  /**
   * Reconcile a single already-open document against the current `shouldSync` predicate, sending
   * a full-text `didOpen` or a `didClose` if its synced state is out of date. Used to resync every
   * open document when a workspace-wide condition (project mode) changes retroactively.
   */
  reconcileDocument: (document: Document) => Promise<void>;
  /** Whether the given URI is currently considered synced. Exposed for tests/inspection. */
  isSynced: (uri: string) => boolean;
  /** Drop all tracked synced state without sending any notifications (e.g. after the client stops). */
  reset: () => void;
};

export function createDocumentSyncGuards<Document, ChangeEvent extends { document: Document }>(
  deps: DocumentSyncDeps<Document>,
): DocumentSyncGuards<Document, ChangeEvent> {
  const synced = new Set<string>();
  const queues = new Map<string, Promise<void>>();

  /** Run `task` after any prior work queued for `uri` has settled; never lets one failure jam the queue. */
  function serialize(uri: string, task: () => Promise<void>): Promise<void> {
    const prior = queues.get(uri) ?? Promise.resolve();
    const settled = prior.then(task, task);
    queues.set(
      uri,
      settled.then(
        () => undefined,
        () => undefined,
      ),
    );
    return settled;
  }

  /** Send the transition notification (if any) for `document`'s current predicate vs. tracked state. */
  async function reconcile(document: Document): Promise<"opened" | "closed" | "unchanged"> {
    const uri = deps.getUri(document);
    const wanted = deps.shouldSync(document);
    const wasSynced = synced.has(uri);

    if (wanted && !wasSynced) {
      synced.add(uri);
      await deps.sendDidOpen(document);
      return "opened";
    }
    if (!wanted && wasSynced) {
      synced.delete(uri);
      await deps.sendDidClose(uri);
      return "closed";
    }
    return "unchanged";
  }

  return {
    didOpen: (document, next) =>
      serialize(deps.getUri(document), async () => {
        const uri = deps.getUri(document);
        if (!deps.shouldSync(document)) return;
        if (synced.has(uri)) return; // already synced (e.g. via reconciliation)
        synced.add(uri);
        await next(document);
      }),

    didChange: (event, next) =>
      serialize(deps.getUri(event.document), async () => {
        const transition = await reconcile(event.document);
        if (transition !== "unchanged") return; // transition notification already sent; the
        // triggering delta is either already included in the synthetic didOpen's full text
        // (false -> true) or moot because the server buffer was just closed (true -> false).
        if (!deps.shouldSync(event.document)) return; // steady state: still not synced
        await next(event);
      }),

    didClose: (document, next) =>
      serialize(deps.getUri(document), async () => {
        const uri = deps.getUri(document);
        if (!synced.has(uri)) return;
        synced.delete(uri);
        await next(document);
      }),

    reconcileDocument: (document) =>
      serialize(deps.getUri(document), async () => {
        await reconcile(document);
      }),

    isSynced: (uri) => synced.has(uri),

    reset: () => {
      synced.clear();
      queues.clear();
    },
  };
}
