import { describe, expect, test } from "bun:test";
import { createDocumentProviderGuards } from "./provider-guards.ts";

type Document = {
  readonly text: string;
};

const providerNames = [
  "provideReferences",
  "prepareRename",
  "provideRenameEdits",
  "provideCodeActions",
  "provideDocumentLinks",
] as const;

describe("document provider middleware guards", () => {
  for (const providerName of providerNames) {
    test(`${providerName} suppresses an unsynchronized document`, async () => {
      const guards = createDocumentProviderGuards((document: Document) => document.text.startsWith("openapi:"));
      let forwarded = false;

      const result = await guards[providerName]({ text: "components:\n  schemas: {}" }, async () => {
        forwarded = true;
        return "forwarded";
      });

      expect(forwarded).toBe(false);
      expect(result).toBeUndefined();
    });

    test(`${providerName} forwards the synchronized current document after a predicate transition`, async () => {
      const guards = createDocumentProviderGuards((document: Document) => document.text.startsWith("openapi:"));
      const document: Document = { text: "components:\n  schemas: {}" };
      let forwardedText: string | undefined;

      await guards[providerName](document, async (currentDocument) => {
        forwardedText = currentDocument.text;
        return "unexpected";
      });

      const synchronizedDocument: Document = { text: "openapi: 3.1.0\ncomponents:\n  schemas: {}" };
      const result = await guards[providerName](synchronizedDocument, async (currentDocument) => {
        forwardedText = currentDocument.text;
        return "forwarded";
      });

      expect(forwardedText).toBe(synchronizedDocument.text);
      expect(result).toBe("forwarded");
    });
  }
});
