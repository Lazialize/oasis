import { describe, expect, test } from "bun:test";
import { InMemoryFileSystem } from "@oasis/core";
import { DiagnosticSeverity } from "vscode-languageserver";
import { createServerContext } from "../src/workspace.ts";
import { getDiagnosticsByFile } from "../src/diagnostics.ts";

const ENTRY_PATH = "/repo2/entry.yaml";

const BAD_TEXT = `openapi: 3.1.0
info:
  title: Bad
  version: "1.0.0"
paths:
  /pets:
    get:
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Missing'
`;

describe("getDiagnosticsByFile", () => {
  test("maps lint diagnostics to LSP severities and rule codes", async () => {
    const ctx = createServerContext(new InMemoryFileSystem({ [ENTRY_PATH]: BAD_TEXT }));

    const byFile = await getDiagnosticsByFile(ctx, ENTRY_PATH);
    const diagnostics = byFile.get(ENTRY_PATH) ?? [];

    const unresolvedRef = diagnostics.find((d) => d.code === "refs/no-unresolved");
    expect(unresolvedRef).toBeDefined();
    expect(unresolvedRef?.severity).toBe(DiagnosticSeverity.Error);
    expect(unresolvedRef?.source).toBe("oasis");

    const missingOperationId = diagnostics.find((d) => d.code === "operation/operation-id");
    expect(missingOperationId).toBeDefined();
  });

  test("clean document produces no error-severity diagnostics", async () => {
    const cleanPath = "/repo3/entry.yaml";
    const cleanText = `openapi: 3.1.0
info:
  title: Clean
  version: "1.0.0"
paths:
  /pets:
    get:
      operationId: listPets
      tags: [pets]
      description: List pets.
      responses:
        '200':
          description: OK
`;
    const ctx = createServerContext(new InMemoryFileSystem({ [cleanPath]: cleanText }));
    const byFile = await getDiagnosticsByFile(ctx, cleanPath);
    const diagnostics = byFile.get(cleanPath) ?? [];
    expect(diagnostics.some((d) => d.severity === DiagnosticSeverity.Error)).toBe(false);
  });
});
