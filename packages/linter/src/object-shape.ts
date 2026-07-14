import { isMap, isScalar, isSeq } from "yaml";
import type { Node } from "yaml";
import type { OpenApiVersion } from "@oasis/core";

/**
 * A version-aware, declarative description of every OpenAPI Object's shape — required fields,
 * per-field value types and version availability, mutually exclusive field groups, `$ref`
 * (Reference Object) allowance, and `x-*` extension allowance. This is the single source of truth
 * shared by two consumers:
 *
 * - the linter's `structure/object-shape` rule, which validates objects nothing else deeply checks
 *   (Info/Contact/License/Server/Tag/External Documentation Objects) against their shape, and
 * - the LSP server's completion contexts, which offer only the keys legal at a cursor for the
 *   document's version (see `packages/server/src/keywords.ts`).
 *
 * Keeping both on one table means a field added for 3.1 (or a new component section) is described
 * once and both the diagnostics and the editor suggestions stay in sync.
 */

/** JSON value types a field may hold. An empty/absent `types` list means "any type". */
export type FieldType = "string" | "boolean" | "number" | "integer" | "object" | "array" | "null";

export interface FieldSpec {
  /** Allowed JSON types for the field's value. Omit for "any type accepted". */
  types?: readonly FieldType[];
  /** OpenAPI versions this field is legal in. Omit when legal in both 3.0 and 3.1. */
  versions?: readonly OpenApiVersion[];
}

export interface ObjectShape {
  /** Human-readable object name for diagnostics, e.g. "Info Object". */
  name: string;
  /** Field names required to be present. Fields whose requirement is version-specific are omitted here. */
  required?: readonly string[];
  /** Every known field and its spec. */
  fields: Readonly<Record<string, FieldSpec>>;
  /** Groups of fields that may not co-occur (e.g. Example Object's `value` / `externalValue`). */
  mutuallyExclusive?: readonly (readonly string[])[];
  /** Whether `x-*` extension fields are allowed. Defaults to true (most OpenAPI objects allow them). */
  extensions?: boolean;
  /** Whether a `$ref` here makes the object a Reference Object (skipped by shape validation). */
  referenceable?: boolean;
  /**
   * Whether keys beyond `fields` (and extensions) are tolerated without an "unknown field"
   * diagnostic. True for map-like or free-form objects (e.g. a Schema Object under 3.1 may carry
   * arbitrary JSON Schema vocabulary keys). Defaults to false.
   */
  allowUnknownFields?: boolean;
}

const S: readonly FieldType[] = ["string"];
const B: readonly FieldType[] = ["boolean"];
const A: readonly FieldType[] = ["array"];
const O: readonly FieldType[] = ["object"];
const V31: readonly OpenApiVersion[] = ["3.1"];
const V30: readonly OpenApiVersion[] = ["3.0"];

/** Every object kind the shape table describes; also the classification vocabulary the server shares. */
export type ObjectKind =
  | "root"
  | "info"
  | "contact"
  | "license"
  | "server"
  | "serverVariable"
  | "externalDocs"
  | "tag"
  | "pathItem"
  | "operation"
  | "parameter"
  | "header"
  | "requestBody"
  | "responses"
  | "response"
  | "mediaType"
  | "encoding"
  | "example"
  | "link"
  | "callback"
  | "schema"
  | "components"
  | "securityScheme"
  | "oauthFlows"
  | "oauthFlow";

const HTTP_METHOD_FIELDS: Record<string, FieldSpec> = {
  get: { types: O },
  put: { types: O },
  post: { types: O },
  delete: { types: O },
  options: { types: O },
  head: { types: O },
  patch: { types: O },
  trace: { types: O },
};

/**
 * Schema Object fields. Deliberately broad and mostly type-loose: the Schema Object is
 * dialect-heavy and deeply validated by `structure/schema-*` rules; this entry exists so the server
 * can offer version-correct schema key completions and is not used by the shape rule.
 */
const SCHEMA_FIELDS: Record<string, FieldSpec> = {
  title: { types: S },
  description: { types: S },
  type: {}, // string (3.0) or string | string[] (3.1)
  format: { types: S },
  default: {},
  enum: { types: A },
  multipleOf: { types: ["number", "integer"] },
  maximum: { types: ["number", "integer"] },
  exclusiveMaximum: {}, // boolean (3.0) or number (3.1)
  minimum: { types: ["number", "integer"] },
  exclusiveMinimum: {}, // boolean (3.0) or number (3.1)
  maxLength: { types: ["integer"] },
  minLength: { types: ["integer"] },
  pattern: { types: S },
  items: {},
  maxItems: { types: ["integer"] },
  minItems: { types: ["integer"] },
  uniqueItems: { types: B },
  maxProperties: { types: ["integer"] },
  minProperties: { types: ["integer"] },
  required: { types: A },
  properties: { types: O },
  additionalProperties: {},
  allOf: { types: A },
  oneOf: { types: A },
  anyOf: { types: A },
  not: { types: O },
  $ref: { types: S },
  readOnly: { types: B },
  writeOnly: { types: B },
  xml: { types: O },
  externalDocs: { types: O },
  deprecated: { types: B },
  discriminator: { types: O },
  // 3.0 only
  nullable: { types: B, versions: V30 },
  example: { versions: V30 },
  // 3.1 only (JSON Schema 2020-12)
  const: { versions: V31 },
  examples: { types: A, versions: V31 },
  $id: { types: S, versions: V31 },
  $schema: { types: S, versions: V31 },
  $anchor: { types: S, versions: V31 },
  $defs: { types: O, versions: V31 },
  $comment: { types: S, versions: V31 },
  prefixItems: { types: A, versions: V31 },
  contains: { types: O, versions: V31 },
  maxContains: { types: ["integer"], versions: V31 },
  minContains: { types: ["integer"], versions: V31 },
  patternProperties: { types: O, versions: V31 },
  propertyNames: { types: O, versions: V31 },
  dependentSchemas: { types: O, versions: V31 },
  dependentRequired: { types: O, versions: V31 },
  unevaluatedProperties: { versions: V31 },
  unevaluatedItems: { versions: V31 },
  if: { types: O, versions: V31 },
  then: { types: O, versions: V31 },
  else: { types: O, versions: V31 },
  contentMediaType: { types: S, versions: V31 },
  contentEncoding: { types: S, versions: V31 },
  contentSchema: { types: O, versions: V31 },
};

/** The declarative shape of every OpenAPI Object, keyed by `ObjectKind`. */
export const OBJECT_SHAPES: Readonly<Record<ObjectKind, ObjectShape>> = {
  root: {
    name: "OpenAPI Object",
    required: ["openapi", "info"],
    extensions: true,
    fields: {
      openapi: { types: S },
      info: { types: O },
      servers: { types: A },
      paths: { types: O },
      components: { types: O },
      security: { types: A },
      tags: { types: A },
      externalDocs: { types: O },
      // 3.1 only
      webhooks: { types: O, versions: V31 },
      jsonSchemaDialect: { types: S, versions: V31 },
    },
  },
  info: {
    name: "Info Object",
    required: ["title", "version"],
    extensions: true,
    fields: {
      title: { types: S },
      description: { types: S },
      termsOfService: { types: S },
      contact: { types: O },
      license: { types: O },
      version: { types: S },
      summary: { types: S, versions: V31 },
    },
  },
  contact: {
    name: "Contact Object",
    extensions: true,
    fields: {
      name: { types: S },
      url: { types: S },
      email: { types: S },
    },
  },
  license: {
    name: "License Object",
    required: ["name"],
    extensions: true,
    mutuallyExclusive: [["identifier", "url"]],
    fields: {
      name: { types: S },
      url: { types: S },
      identifier: { types: S, versions: V31 },
    },
  },
  server: {
    name: "Server Object",
    required: ["url"],
    extensions: true,
    fields: {
      url: { types: S },
      description: { types: S },
      variables: { types: O },
    },
  },
  serverVariable: {
    name: "Server Variable Object",
    required: ["default"],
    extensions: true,
    fields: {
      enum: { types: A },
      default: { types: S },
      description: { types: S },
    },
  },
  externalDocs: {
    name: "External Documentation Object",
    required: ["url"],
    extensions: true,
    fields: {
      description: { types: S },
      url: { types: S },
    },
  },
  tag: {
    name: "Tag Object",
    required: ["name"],
    extensions: true,
    fields: {
      name: { types: S },
      description: { types: S },
      externalDocs: { types: O },
    },
  },
  pathItem: {
    name: "Path Item Object",
    extensions: true,
    referenceable: true,
    fields: {
      $ref: { types: S },
      summary: { types: S },
      description: { types: S },
      servers: { types: A },
      parameters: { types: A },
      ...HTTP_METHOD_FIELDS,
    },
  },
  operation: {
    name: "Operation Object",
    extensions: true,
    fields: {
      tags: { types: A },
      summary: { types: S },
      description: { types: S },
      externalDocs: { types: O },
      operationId: { types: S },
      parameters: { types: A },
      requestBody: { types: O },
      responses: { types: O },
      callbacks: { types: O },
      deprecated: { types: B },
      security: { types: A },
      servers: { types: A },
    },
  },
  parameter: {
    name: "Parameter Object",
    required: ["name", "in"],
    extensions: true,
    referenceable: true,
    mutuallyExclusive: [["schema", "content"]],
    fields: {
      name: { types: S },
      in: { types: S },
      description: { types: S },
      required: { types: B },
      deprecated: { types: B },
      allowEmptyValue: { types: B },
      style: { types: S },
      explode: { types: B },
      allowReserved: { types: B },
      schema: { types: O },
      example: {},
      examples: { types: O },
      content: { types: O },
      $ref: { types: S },
    },
  },
  header: {
    name: "Header Object",
    extensions: true,
    referenceable: true,
    mutuallyExclusive: [["schema", "content"]],
    fields: {
      description: { types: S },
      required: { types: B },
      deprecated: { types: B },
      style: { types: S },
      explode: { types: B },
      schema: { types: O },
      example: {},
      examples: { types: O },
      content: { types: O },
      $ref: { types: S },
    },
  },
  requestBody: {
    name: "Request Body Object",
    required: ["content"],
    extensions: true,
    referenceable: true,
    fields: {
      description: { types: S },
      content: { types: O },
      required: { types: B },
      $ref: { types: S },
    },
  },
  responses: {
    name: "Responses Object",
    extensions: true,
    // Keys are status codes / "default"; described as a map, so unknown keys are tolerated here.
    allowUnknownFields: true,
    fields: {
      default: { types: O },
    },
  },
  response: {
    name: "Response Object",
    required: ["description"],
    extensions: true,
    referenceable: true,
    fields: {
      description: { types: S },
      headers: { types: O },
      content: { types: O },
      links: { types: O },
      $ref: { types: S },
    },
  },
  mediaType: {
    name: "Media Type Object",
    extensions: true,
    fields: {
      schema: { types: O },
      example: {},
      examples: { types: O },
      encoding: { types: O },
    },
  },
  encoding: {
    name: "Encoding Object",
    extensions: true,
    fields: {
      contentType: { types: S },
      headers: { types: O },
      style: { types: S },
      explode: { types: B },
      allowReserved: { types: B },
    },
  },
  example: {
    name: "Example Object",
    extensions: true,
    referenceable: true,
    mutuallyExclusive: [["value", "externalValue"]],
    fields: {
      summary: { types: S },
      description: { types: S },
      value: {},
      externalValue: { types: S },
      $ref: { types: S },
    },
  },
  link: {
    name: "Link Object",
    extensions: true,
    referenceable: true,
    mutuallyExclusive: [["operationRef", "operationId"]],
    fields: {
      operationRef: { types: S },
      operationId: { types: S },
      parameters: { types: O },
      requestBody: {},
      description: { types: S },
      server: { types: O },
      $ref: { types: S },
    },
  },
  callback: {
    name: "Callback Object",
    extensions: true,
    referenceable: true,
    // Keys are runtime expressions mapping to Path Item Objects; no fixed field set.
    allowUnknownFields: true,
    fields: {
      $ref: { types: S },
    },
  },
  schema: {
    name: "Schema Object",
    extensions: true,
    referenceable: true,
    allowUnknownFields: true,
    fields: SCHEMA_FIELDS,
  },
  components: {
    name: "Components Object",
    extensions: true,
    fields: {
      schemas: { types: O },
      responses: { types: O },
      parameters: { types: O },
      examples: { types: O },
      requestBodies: { types: O },
      headers: { types: O },
      securitySchemes: { types: O },
      links: { types: O },
      callbacks: { types: O },
      pathItems: { types: O, versions: V31 },
    },
  },
  securityScheme: {
    name: "Security Scheme Object",
    required: ["type"],
    extensions: true,
    referenceable: true,
    fields: {
      type: { types: S },
      description: { types: S },
      name: { types: S },
      in: { types: S },
      scheme: { types: S },
      bearerFormat: { types: S },
      flows: { types: O },
      openIdConnectUrl: { types: S },
      $ref: { types: S },
    },
  },
  oauthFlows: {
    name: "OAuth Flows Object",
    extensions: true,
    fields: {
      implicit: { types: O },
      password: { types: O },
      clientCredentials: { types: O },
      authorizationCode: { types: O },
    },
  },
  oauthFlow: {
    name: "OAuth Flow Object",
    extensions: true,
    fields: {
      authorizationUrl: { types: S },
      tokenUrl: { types: S },
      refreshUrl: { types: S },
      scopes: { types: O },
    },
  },
};

/** Whether `key` is an OpenAPI extension field (`x-...`). */
export function isExtensionKey(key: string): boolean {
  return key.startsWith("x-");
}

/** Whether `spec` is available in `version` (a field with no `versions` list is available in both). */
export function fieldAvailableIn(spec: FieldSpec, version: OpenApiVersion): boolean {
  return !spec.versions || spec.versions.includes(version);
}

/**
 * The field names legal on `kind` for `version`, in declaration order. Used to drive the LSP
 * server's key completions from the same table the linter validates against.
 */
export function allowedFieldNames(kind: ObjectKind, version: OpenApiVersion): string[] {
  const shape = OBJECT_SHAPES[kind];
  return Object.entries(shape.fields)
    .filter(([, spec]) => fieldAvailableIn(spec, version))
    .map(([name]) => name);
}

function nodeMatchesType(node: Node, types: readonly FieldType[]): boolean {
  if (types.length === 0) return true;
  for (const t of types) {
    if (t === "object" && isMap(node)) return true;
    if (t === "array" && isSeq(node)) return true;
    if (isScalar(node)) {
      const v = node.value;
      if (t === "null" && v === null) return true;
      if (t === "string" && typeof v === "string") return true;
      if (t === "boolean" && typeof v === "boolean") return true;
      if (t === "number" && typeof v === "number") return true;
      if (t === "integer" && typeof v === "number" && Number.isInteger(v)) return true;
    }
  }
  return false;
}

function typeLabel(types: readonly FieldType[]): string {
  const articled = types.map((t) => (t === "array" ? "an array" : t === "object" ? "an object" : `a ${t}`));
  return articled.join(" or ");
}

/** A shape violation, attached to the offending node so the caller can resolve its source range. */
export interface ShapeViolation {
  node: Node;
  message: string;
}

/** Import kept minimal to avoid a hard dependency; matches `util.ts` helpers. */
function keyString(key: unknown): string {
  if (isScalar(key)) return String(key.value);
  return String(key);
}

function childNode(map: Node, name: string): Node | undefined {
  if (!isMap(map)) return undefined;
  const pair = map.items.find((p) => keyString(p.key) === name);
  return pair && "value" in pair && pair.value && typeof pair.value === "object" ? (pair.value as Node) : undefined;
}

/**
 * Validate the map `node` against `shape` for `version`, reporting each violation through `report`.
 * `label` is prefixed to messages (e.g. `"info"` -> `"info" is missing ...`). A Reference Object
 * (a referenceable shape carrying `$ref`) is skipped — its target is validated at its definition
 * site. Ranges are never computed here: the caller attaches `report` to nodes that already carry
 * source positions, keeping every diagnostic traceable to its file and line/column.
 */
export function validateObjectShape(
  shape: ObjectShape,
  node: Node,
  version: OpenApiVersion,
  label: string,
  report: (node: Node, message: string) => void,
): void {
  if (!isMap(node)) {
    report(node, `${label} must be an object.`);
    return;
  }

  // A Reference Object: `$ref` replaces the object; other keys are ignored per spec.
  if (shape.referenceable && childNode(node, "$ref")) return;

  const present = new Map<string, Node>();
  for (const pair of node.items) {
    const key = keyString(pair.key);
    const value = "value" in pair && pair.value && typeof pair.value === "object" ? (pair.value as Node) : undefined;
    if (value) present.set(key, value);

    if (isExtensionKey(key)) {
      if (shape.extensions === false) {
        report(value ?? node, `${label} does not allow extension field "${key}".`);
      }
      continue;
    }

    const spec = shape.fields[key];
    if (!spec) {
      if (!shape.allowUnknownFields) {
        report(value ?? node, `${label} has unknown field "${key}".`);
      }
      continue;
    }
    if (!fieldAvailableIn(spec, version)) {
      report(value ?? node, `${label} field "${key}" is not valid in OpenAPI ${version}.`);
      continue;
    }
    if (value && spec.types && spec.types.length > 0 && !nodeMatchesType(value, spec.types)) {
      report(value, `${label} field "${key}" must be ${typeLabel(spec.types)}.`);
    }
  }

  for (const req of shape.required ?? []) {
    if (!present.has(req)) {
      report(node, `${label} is missing required field "${req}".`);
    }
  }

  for (const group of shape.mutuallyExclusive ?? []) {
    const set = group.filter((f) => present.has(f));
    if (set.length > 1) {
      report(node, `${label} must not set both ${set.map((f) => `"${f}"`).join(" and ")}; they are mutually exclusive.`);
    }
  }
}
