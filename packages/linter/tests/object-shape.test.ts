import { describe, expect, test } from "bun:test";
import { InMemoryFileSystem, loadWorkspaceGraph } from "@oasis/core";
import { lint } from "../src/engine.ts";
import { resolveConfig } from "../src/config.ts";
import { allowedFieldNames, fieldAvailableIn, OBJECT_SHAPES } from "../src/object-shape.ts";

const ENTRY = "/w/openapi.yaml";

async function lintDoc(text: string) {
  const fs = new InMemoryFileSystem({ [ENTRY]: text });
  const graph = await loadWorkspaceGraph(fs, ENTRY);
  return lint(graph, resolveConfig(undefined));
}

function shapeDiags(diagnostics: { rule: string; message: string }[]) {
  return diagnostics.filter((d) => d.rule === "structure/object-shape");
}

const HEADER_31 = `openapi: 3.1.0\ninfo:\n  title: T\n  version: "1"\npaths: {}\n`;
const HEADER_30 = `openapi: 3.0.3\ninfo:\n  title: T\n  version: "1"\npaths: {}\n`;

describe("structure/object-shape — valid documents stay clean", () => {
  test("a well-formed 3.1 document reports no shape diagnostics", async () => {
    const doc = `openapi: 3.1.0
info:
  title: My API
  version: "1.0.0"
  summary: A short summary
  contact:
    name: Support
    url: https://example.com
    email: team@example.com
  license:
    name: MIT
    identifier: MIT
externalDocs:
  description: More
  url: https://docs.example.com
servers:
  - url: https://api.example.com
    description: Prod
tags:
  - name: pets
    description: Pet ops
    externalDocs:
      url: https://docs.example.com/pets
paths: {}
`;
    expect(shapeDiags(await lintDoc(doc))).toEqual([]);
  });

  test("a well-formed 3.0 document reports no shape diagnostics", async () => {
    const doc = `openapi: 3.0.3
info:
  title: My API
  version: "1.0.0"
  contact:
    name: Support
  license:
    name: Apache 2.0
    url: https://www.apache.org/licenses/LICENSE-2.0
servers:
  - url: https://api.example.com
paths: {}
`;
    expect(shapeDiags(await lintDoc(doc))).toEqual([]);
  });
});

interface BadCase {
  name: string;
  doc: string;
  expect: string; // substring the message must contain
}

const BAD_CASES: BadCase[] = [
  {
    name: "Contact Object: wrong field type",
    doc: `${HEADER_31.replace("paths: {}\n", "")}` + "  contact:\n    email: 42\npaths: {}\n",
    expect: 'field "email" must be a string',
  },
  {
    name: "License Object: missing required name",
    doc: HEADER_31.replace("  version: \"1\"\n", "  version: \"1\"\n  license:\n    url: https://x\n"),
    expect: 'is missing required field "name"',
  },
  {
    name: "License Object: identifier/url mutually exclusive",
    doc: HEADER_31.replace(
      "  version: \"1\"\n",
      "  version: \"1\"\n  license:\n    name: MIT\n    identifier: MIT\n    url: https://x\n",
    ),
    expect: "mutually exclusive",
  },
  {
    name: "Tag Object: missing required name",
    doc: HEADER_31 + "tags:\n  - description: nameless\n",
    expect: 'is missing required field "name"',
  },
  {
    name: "External Documentation Object: missing required url",
    doc: HEADER_31 + "externalDocs:\n  description: no url\n",
    expect: 'is missing required field "url"',
  },
  {
    name: "Info Object: unknown field",
    doc: HEADER_31.replace("  version: \"1\"\n", "  version: \"1\"\n  bogus: nope\n"),
    expect: 'has unknown field "bogus"',
  },
];

describe("structure/object-shape — bad cases", () => {
  for (const c of BAD_CASES) {
    test(c.name, async () => {
      const diags = shapeDiags(await lintDoc(c.doc));
      expect(diags.some((d) => d.message.includes(c.expect))).toBe(true);
    });
  }
});

describe("structure/object-shape — version-aware fields", () => {
  test("3.1-only Info.summary is rejected on a 3.0 document", async () => {
    const doc = HEADER_30.replace("  version: \"1\"\n", "  version: \"1\"\n  summary: hi\n");
    const diags = shapeDiags(await lintDoc(doc));
    expect(diags.some((d) => d.message.includes('field "summary" is not valid in OpenAPI 3.0'))).toBe(true);
  });

  test("3.1-only Info.summary is accepted on a 3.1 document", async () => {
    const doc = HEADER_31.replace("  version: \"1\"\n", "  version: \"1\"\n  summary: hi\n");
    expect(shapeDiags(await lintDoc(doc))).toEqual([]);
  });

  test("3.1-only License.identifier is rejected on a 3.0 document", async () => {
    const doc = HEADER_30.replace(
      "  version: \"1\"\n",
      "  version: \"1\"\n  license:\n    name: MIT\n    identifier: MIT\n",
    );
    const diags = shapeDiags(await lintDoc(doc));
    expect(diags.some((d) => d.message.includes('field "identifier" is not valid in OpenAPI 3.0'))).toBe(true);
  });
});

describe("shared object-shape table helpers", () => {
  test("allowedFieldNames respects version availability (root)", () => {
    const v31 = allowedFieldNames("root", "3.1");
    const v30 = allowedFieldNames("root", "3.0");
    expect(v31).toContain("webhooks");
    expect(v31).toContain("jsonSchemaDialect");
    expect(v30).not.toContain("webhooks");
    expect(v30).not.toContain("jsonSchemaDialect");
  });

  test("allowedFieldNames respects version availability (schema)", () => {
    const v31 = allowedFieldNames("schema", "3.1");
    const v30 = allowedFieldNames("schema", "3.0");
    expect(v30).toContain("nullable");
    expect(v30).not.toContain("const");
    expect(v31).not.toContain("nullable");
    expect(v31).toContain("const");
    expect(v31).toContain("prefixItems");
    expect(v31).toContain("patternProperties");
    expect(v31).toContain("$defs");
  });

  test("components section gains pathItems only in 3.1", () => {
    expect(allowedFieldNames("components", "3.1")).toContain("pathItems");
    expect(allowedFieldNames("components", "3.0")).not.toContain("pathItems");
  });

  test("every shape's required fields are declared fields", () => {
    for (const [kind, shape] of Object.entries(OBJECT_SHAPES)) {
      for (const req of shape.required ?? []) {
        expect(shape.fields[req], `${kind}.${req}`).toBeDefined();
      }
    }
  });

  test("every mutually-exclusive field is a declared field", () => {
    for (const [kind, shape] of Object.entries(OBJECT_SHAPES)) {
      for (const group of shape.mutuallyExclusive ?? []) {
        for (const f of group) {
          expect(shape.fields[f], `${kind}.${f}`).toBeDefined();
        }
      }
    }
  });

  test("fieldAvailableIn defaults to both versions when unversioned", () => {
    expect(fieldAvailableIn({ types: ["string"] }, "3.0")).toBe(true);
    expect(fieldAvailableIn({ types: ["string"] }, "3.1")).toBe(true);
    expect(fieldAvailableIn({ versions: ["3.1"] }, "3.0")).toBe(false);
  });
});
