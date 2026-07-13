import { describe, expect, test } from "bun:test";
import { InMemoryFileSystem, loadWorkspaceGraph } from "@oasis/core";
import { lint } from "../src/engine.ts";
import { resolveConfig } from "../src/config.ts";

/**
 * Regression tests for three example-validation fixes:
 * - #61: minLength/maxLength count Unicode code points, not UTF-16 code units.
 * - #43: patternProperties-permitted keys aren't "additional" under additionalProperties: false.
 * - #42: failures pointing at a schema keyword in another file carry that file, not the example's.
 */

async function lintFiles(files: Record<string, string>, entry = "/virtual/entry.yaml") {
  const fs = new InMemoryFileSystem(files);
  const graph = await loadWorkspaceGraph(fs, entry);
  return lint(graph, resolveConfig(undefined));
}

import type { LintDiagnostic } from "../src/types.ts";

function matchDiags(diags: LintDiagnostic[]) {
  return diags.filter((d) => d.rule === "examples/schema-match");
}

const schemaDoc = (schemaYaml: string) => `openapi: 3.1.0
info:
  title: Examples
  version: "1.0.0"
paths: {}
components:
  schemas:
${schemaYaml}
`;

describe("minLength/maxLength count code points (issue #61)", () => {
  test("a single supplementary-plane emoji satisfies maxLength: 1", async () => {
    const diagnostics = await lintFiles({
      "/virtual/entry.yaml": schemaDoc(`    Emoji:
      type: string
      maxLength: 1
      example: "\u{1F600}"`),
    });
    expect(matchDiags(diagnostics)).toEqual([]);
  });

  test("BMP text is still measured correctly", async () => {
    const diagnostics = await lintFiles({
      "/virtual/entry.yaml": schemaDoc(`    Word:
      type: string
      minLength: 2
      maxLength: 5
      example: "abc"`),
    });
    expect(matchDiags(diagnostics)).toEqual([]);
  });

  test("combining marks count as separate code points", async () => {
    // "e" + U+0301 combining acute = 2 code points (JSON Schema counts code points, not graphemes).
    const diagnostics = await lintFiles({
      "/virtual/entry.yaml": schemaDoc(`    Accent:
      type: string
      maxLength: 1
      example: "é"`),
    });
    const diags = matchDiags(diagnostics);
    expect(diags.length).toBe(1);
    expect(diags[0]?.message).toContain("string length 2 is above maxLength 1");
  });

  test("a mixed string reports its code-point length in the diagnostic", async () => {
    // "a" + emoji (2 UTF-16 units) + "b" = 3 code points, 4 UTF-16 units.
    const diagnostics = await lintFiles({
      "/virtual/entry.yaml": schemaDoc(`    Mixed:
      type: string
      maxLength: 2
      example: "a\u{1F600}b"`),
    });
    const diags = matchDiags(diagnostics);
    expect(diags.length).toBe(1);
    expect(diags[0]?.message).toContain("string length 3 is above maxLength 2");
  });

  test("minLength uses code points too (emoji-only string of length 2)", async () => {
    const diagnostics = await lintFiles({
      "/virtual/entry.yaml": schemaDoc(`    TwoEmoji:
      type: string
      minLength: 3
      example: "\u{1F600}\u{1F601}"`),
    });
    const diags = matchDiags(diagnostics);
    expect(diags.length).toBe(1);
    expect(diags[0]?.message).toContain("string length 2 is below minLength 3");
  });
});

describe("patternProperties in example validation (issue #43)", () => {
  test("a key permitted by patternProperties is not additional (repro from the issue)", async () => {
    const diagnostics = await lintFiles({
      "/virtual/entry.yaml": schemaDoc(`    Config:
      type: object
      patternProperties:
        "^x-":
          type: string
      additionalProperties: false
      example:
        x-name: ok`),
    });
    expect(matchDiags(diagnostics)).toEqual([]);
  });

  test("values of pattern-matched keys are validated against the pattern schema", async () => {
    const diagnostics = await lintFiles({
      "/virtual/entry.yaml": schemaDoc(`    Config:
      type: object
      patternProperties:
        "^x-":
          type: string
      example:
        x-name: 42`),
    });
    const diags = matchDiags(diagnostics);
    expect(diags.length).toBe(1);
    expect(diags[0]?.message).toContain('expected type "string"');
  });

  test("a key matching multiple patterns is validated against every matching schema", async () => {
    const diagnostics = await lintFiles({
      "/virtual/entry.yaml": schemaDoc(`    Multi:
      type: object
      patternProperties:
        "^x-":
          type: string
        "-name$":
          type: string
          minLength: 5
      example:
        x-name: ok`),
    });
    const diags = matchDiags(diagnostics);
    expect(diags.length).toBe(1);
    expect(diags[0]?.message).toContain("below minLength 5");
  });

  test("a key matching neither properties nor patternProperties is still additional", async () => {
    const diagnostics = await lintFiles({
      "/virtual/entry.yaml": schemaDoc(`    Strict:
      type: object
      properties:
        name:
          type: string
      patternProperties:
        "^x-":
          type: string
      additionalProperties: false
      example:
        name: a
        x-tag: b
        rogue: c`),
    });
    const diags = matchDiags(diagnostics);
    expect(diags.length).toBe(1);
    expect(diags[0]?.message).toContain('unexpected property "rogue"');
  });

  test("an invalid patternProperties regex does not crash and matches nothing", async () => {
    const diagnostics = await lintFiles({
      "/virtual/entry.yaml": schemaDoc(`    BadRegex:
      type: object
      patternProperties:
        "([":
          type: string
      example:
        anything: ok`),
    });
    // No additionalProperties: false here, so the unmatched key is simply allowed.
    expect(matchDiags(diagnostics)).toEqual([]);
  });
});

describe("failure diagnostics keep their owning document (issue #42)", () => {
  test("a violated schema keyword in another file is reported in that file", async () => {
    const diagnostics = await lintFiles({
      "/virtual/entry.yaml": `openapi: 3.1.0
info:
  title: CrossFile
  version: "1.0.0"
paths:
  /pets:
    get:
      operationId: listPets
      tags: [a]
      description: x
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: "./schema.yaml#/components/schemas/Name"
              example: "way-too-long-value"
`,
      "/virtual/schema.yaml": `openapi: 3.1.0
info:
  title: Schemas
  version: "1.0.0"
paths: {}
components:
  schemas:
    Name:
      type: string
      maxLength: 3
`,
    });
    const diags = matchDiags(diagnostics);
    expect(diags.length).toBe(1);
    // The failure points at the violated maxLength keyword, which lives in schema.yaml — the
    // range must be converted with (and attributed to) that document, not the example's.
    expect(diags[0]?.range.filePath).toBe("/virtual/schema.yaml");
  });

  test("nested external refs: failure on the example value stays in the example's file", async () => {
    const diagnostics = await lintFiles({
      "/virtual/entry.yaml": `openapi: 3.1.0
info:
  title: CrossFile
  version: "1.0.0"
paths:
  /pets:
    get:
      operationId: listPets
      tags: [a]
      description: x
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: "./schema.yaml#/components/schemas/Pet"
              example:
                name: 42
`,
      "/virtual/schema.yaml": `openapi: 3.1.0
info:
  title: Schemas
  version: "1.0.0"
paths: {}
components:
  schemas:
    Pet:
      type: object
      properties:
        name:
          $ref: "./deep.yaml#/components/schemas/Name"
`,
      "/virtual/deep.yaml": `openapi: 3.1.0
info:
  title: Deep
  version: "1.0.0"
paths: {}
components:
  schemas:
    Name:
      type: string
`,
    });
    const diags = matchDiags(diagnostics);
    expect(diags.length).toBe(1);
    // Type failures point at the invalid example value, which lives in the entry document.
    expect(diags[0]?.range.filePath).toBe("/virtual/entry.yaml");
    expect(diags[0]?.message).toContain('expected type "string"');
  });
});
