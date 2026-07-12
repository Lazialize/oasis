/**
 * Deterministic (seeded) generators for the two synthetic benchmark workloads used by
 * `scripts/bench.ts`. Nothing here is committed as generated output — `bench.ts` calls these
 * at run time and writes the result into a temp directory.
 */

/** Small seeded PRNG (mulberry32) so generated fixtures are reproducible across machines/runs. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)] as T;
}

const SCALAR_TYPES = ["string", "integer", "number", "boolean"] as const;
const TAGS = ["users", "orders", "billing", "inventory", "notifications", "search", "admin", "reports"] as const;

/** One YAML file's worth of text plus the relative path it should be written to. */
export interface GeneratedFile {
  path: string;
  content: string;
}

function indent(text: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((l) => (l.length > 0 ? pad + l : l))
    .join("\n");
}

/**
 * Generate a deeply-nested schema (object properties + allOf/oneOf chains referencing other
 * component schemas) as inline YAML, `depth` levels deep.
 */
function genSchemaBody(rng: () => number, allSchemaNames: string[], depth: number): string {
  const lines: string[] = [];
  const propCount = 3 + Math.floor(rng() * 5);

  if (depth > 0 && rng() < 0.5 && allSchemaNames.length > 0) {
    // allOf chain: extend two other component schemas plus inline properties.
    lines.push("allOf:");
    lines.push(`  - $ref: '#/components/schemas/${pick(rng, allSchemaNames)}'`);
    lines.push("  - type: object");
    lines.push("    properties:");
    for (let i = 0; i < propCount; i++) {
      lines.push(`      field${i}:`);
      lines.push(indent(genLeafSchema(rng, allSchemaNames, depth - 1), 8));
    }
    return lines.join("\n");
  }

  if (depth > 0 && rng() < 0.3 && allSchemaNames.length > 0) {
    lines.push("oneOf:");
    const n = 2 + Math.floor(rng() * 2);
    for (let i = 0; i < n; i++) {
      lines.push(`  - $ref: '#/components/schemas/${pick(rng, allSchemaNames)}'`);
    }
    lines.push("discriminator:");
    lines.push("  propertyName: type");
    return lines.join("\n");
  }

  lines.push("type: object");
  lines.push("properties:");
  for (let i = 0; i < propCount; i++) {
    lines.push(`  field${i}:`);
    lines.push(indent(genLeafSchema(rng, allSchemaNames, depth - 1), 4));
  }
  lines.push("required:");
  lines.push(`  - field0`);
  return lines.join("\n");
}

function genLeafSchema(rng: () => number, allSchemaNames: string[], depth: number): string {
  if (depth > 0 && rng() < 0.25 && allSchemaNames.length > 0) {
    return `$ref: '#/components/schemas/${pick(rng, allSchemaNames)}'`;
  }
  if (rng() < 0.15) {
    return `type: array\nitems:\n${indent(genLeafSchema(rng, allSchemaNames, depth - 1), 2)}`;
  }
  const type = pick(rng, SCALAR_TYPES);
  if (type === "string" && rng() < 0.3) {
    return `type: string\nformat: ${pick(rng, ["date-time", "uuid", "email", "uri"])}`;
  }
  return `type: ${type}`;
}

/** Generate `count` component schema definitions, each referencing earlier ones (never forward). */
function genComponentSchemas(rng: () => number, count: number): { yaml: string; names: string[] } {
  const names: string[] = [];
  const parts: string[] = [];
  for (let i = 0; i < count; i++) {
    const name = `Model${i}`;
    // Only reference schemas already defined, so allOf/oneOf chains form a DAG (no cycles).
    const body = genSchemaBody(rng, names, 3);
    parts.push(`    ${name}:\n${indent(body, 6)}`);
    names.push(name);
  }
  return { yaml: parts.join("\n"), names };
}

function genResponses(rng: () => number, schemaNames: string[]): string {
  const okSchema = pick(rng, schemaNames);
  return [
    "responses:",
    "  '200':",
    "    description: Successful response",
    "    content:",
    "      application/json:",
    "        schema:",
    `          $ref: '#/components/schemas/${okSchema}'`,
    "  '400':",
    "    description: Bad request",
    "    content:",
    "      application/json:",
    "        schema:",
    `          $ref: '#/components/schemas/${pick(rng, schemaNames)}'`,
    "  default:",
    "    description: Unexpected error",
  ].join("\n");
}

function genOperation(rng: () => number, opId: string, schemaNames: string[], withBody: boolean): string {
  const lines: string[] = [];
  lines.push(`operationId: ${opId}`);
  lines.push(`summary: ${opId} summary`);
  lines.push("tags:");
  lines.push(`  - ${pick(rng, TAGS)}`);
  lines.push("parameters:");
  lines.push("  - name: limit");
  lines.push("    in: query");
  lines.push("    schema:");
  lines.push("      type: integer");
  if (withBody) {
    lines.push("requestBody:");
    lines.push("  required: true");
    lines.push("  content:");
    lines.push("    application/json:");
    lines.push("      schema:");
    lines.push(`        $ref: '#/components/schemas/${pick(rng, schemaNames)}'`);
  }
  lines.push(genResponses(rng, schemaNames));
  return lines.join("\n");
}

export interface SingleFileOptions {
  seed: number;
  pathCount: number;
  schemaCount: number;
}

/** Generate one large single-file OpenAPI 3.1 document (paths + deep component schemas). */
export function generateSingleFileSpec(options: SingleFileOptions): string {
  const rng = makeRng(options.seed);
  const { yaml: schemasYaml, names } = genComponentSchemas(rng, options.schemaCount);

  const pathBlocks: string[] = [];
  for (let i = 0; i < options.pathCount; i++) {
    const resource = `resource${i}`;
    pathBlocks.push(`  /${resource}:`);
    pathBlocks.push(`    get:\n${indent(genOperation(rng, `list${resource}`, names, false), 6)}`);
    pathBlocks.push(`    post:\n${indent(genOperation(rng, `create${resource}`, names, true), 6)}`);
    pathBlocks.push(`  /${resource}/{id}:`);
    pathBlocks.push("    parameters:");
    pathBlocks.push("      - name: id");
    pathBlocks.push("        in: path");
    pathBlocks.push("        required: true");
    pathBlocks.push("        schema:");
    pathBlocks.push("          type: string");
    pathBlocks.push(`    get:\n${indent(genOperation(rng, `get${resource}`, names, false), 6)}`);
    pathBlocks.push(`    put:\n${indent(genOperation(rng, `update${resource}`, names, true), 6)}`);
    pathBlocks.push(`    delete:\n${indent(genOperation(rng, `delete${resource}`, names, false), 6)}`);
  }

  return [
    "openapi: 3.1.0",
    "info:",
    "  title: Bench Large Spec",
    "  version: 1.0.0",
    "tags:",
    ...TAGS.map((t) => `  - name: ${t}`),
    "paths:",
    ...pathBlocks,
    "components:",
    "  schemas:",
    schemasYaml,
    "",
  ].join("\n");
}

export interface MultiFileOptions {
  seed: number;
  pathFileCount: number;
  schemaFileCount: number;
  schemasPerFile: number;
}

/**
 * Generate a multi-file workspace: an entry document, one path-item file per resource
 * (heavily cross-referencing shared schema files), and several shared-schema files.
 */
export function generateMultiFileWorkspace(options: MultiFileOptions): GeneratedFile[] {
  const rng = makeRng(options.seed);
  const files: GeneratedFile[] = [];

  // Shared schema files: schemas/shared-N.yaml, each with several models that may reference
  // models in earlier shared files (never forward, so there are no cross-file cycles).
  const allSchemaRefs: { file: string; name: string }[] = [];
  for (let f = 0; f < options.schemaFileCount; f++) {
    const fileName = `schemas/shared-${f}.yaml`;
    const localNames: string[] = [];
    const parts: string[] = [];
    for (let i = 0; i < options.schemasPerFile; i++) {
      const name = `Shared${f}_${i}`;
      const refPool = [...localNames];
      // Occasionally borrow a ref from an earlier shared file via a relative $ref.
      let body: string;
      if (refPool.length > 0 && rng() < 0.4) {
        body = genSchemaBody(rng, refPool, 2);
      } else if (allSchemaRefs.length > 0 && rng() < 0.3) {
        const other = pick(rng, allSchemaRefs);
        body = [
          "allOf:",
          `  - $ref: './${other.file.split("/").pop()}#/components/schemas/${other.name}'`,
          "  - type: object",
          "    properties:",
          "      extra:",
          "        type: string",
        ].join("\n");
      } else {
        body = genSchemaBody(rng, [], 1);
      }
      parts.push(`    ${name}:\n${indent(body, 6)}`);
      localNames.push(name);
      allSchemaRefs.push({ file: fileName, name });
    }
    files.push({
      path: fileName,
      content: ["components:", "  schemas:", parts.join("\n"), ""].join("\n"),
    });
  }

  // Path-item files: paths/resourceN.yaml, each a single Path Item Object referencing schemas
  // from the shared files by relative $ref.
  const pathRefs: string[] = [];
  for (let i = 0; i < options.pathFileCount; i++) {
    const resource = `resource${i}`;
    const fileName = `paths/${resource}.yaml`;
    const schemaChoices = () => {
      const s = pick(rng, allSchemaRefs);
      return `'./../${s.file}#/components/schemas/${s.name}'`;
    };

    const body = [
      "get:",
      `  operationId: list${resource}`,
      "  tags:",
      `    - ${pick(rng, TAGS)}`,
      "  responses:",
      "    '200':",
      "      description: OK",
      "      content:",
      "        application/json:",
      "          schema:",
      `            $ref: ${schemaChoices()}`,
      "post:",
      `  operationId: create${resource}`,
      "  tags:",
      `    - ${pick(rng, TAGS)}`,
      "  requestBody:",
      "    required: true",
      "    content:",
      "      application/json:",
      "        schema:",
      `          $ref: ${schemaChoices()}`,
      "  responses:",
      "    '201':",
      "      description: Created",
      "      content:",
      "        application/json:",
      "          schema:",
      `            $ref: ${schemaChoices()}`,
      "    default:",
      "      description: Unexpected error",
    ].join("\n");

    files.push({ path: fileName, content: body + "\n" });
    pathRefs.push(resource);
  }

  const entryPathsBlock = pathRefs
    .map((resource) => `  /${resource}:\n    $ref: './paths/${resource}.yaml'`)
    .join("\n");

  const entry = [
    "openapi: 3.1.0",
    "info:",
    "  title: Bench Multi-File Workspace",
    "  version: 1.0.0",
    "tags:",
    ...TAGS.map((t) => `  - name: ${t}`),
    "paths:",
    entryPathsBlock,
    "",
  ].join("\n");
  files.push({ path: "openapi.yaml", content: entry });

  return files;
}
