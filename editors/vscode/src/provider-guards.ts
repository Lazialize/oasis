type DocumentProviderGuard<Document> = <Result>(
  document: Document,
  next: (document: Document) => Result | PromiseLike<Result>,
) => Promise<Result | undefined>;

export type DocumentProviderGuards<Document> = {
  provideReferences: DocumentProviderGuard<Document>;
  prepareRename: DocumentProviderGuard<Document>;
  provideRenameEdits: DocumentProviderGuard<Document>;
  provideCodeActions: DocumentProviderGuard<Document>;
  provideDocumentLinks: DocumentProviderGuard<Document>;
};

/** Guard document-scoped requests so they only reach the server for synced documents. */
export function createDocumentProviderGuards<Document>(
  shouldSync: (document: Document) => boolean,
): DocumentProviderGuards<Document> {
  const guard: DocumentProviderGuard<Document> = async (document, next) => {
    if (!shouldSync(document)) return undefined;
    return await next(document);
  };

  return {
    provideReferences: guard,
    prepareRename: guard,
    provideRenameEdits: guard,
    provideCodeActions: guard,
    provideDocumentLinks: guard,
  };
}
