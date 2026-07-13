import { isMap, isNode, isScalar, isSeq } from "yaml";
import type { Node } from "yaml";
import type { OasisDocument } from "@oasis/core";
import { iterateSchemas, walkSchemaTree } from "../openapi-walk.ts";
import { childAt, isRefObject, keyToString } from "../util.ts";
import type { Rule, RuleContext } from "../types.ts";

/**
 * JSON Schema 2020-12 keywords available in OpenAPI 3.1's Schema Object dialect but not in
 * OpenAPI 3.0's (a restricted subset of JSON Schema Draft 4-ish). `nullable` is the inverse case
 * (3.0-only, flagged on 3.1) and is intentionally not handled here — `structure/schema-nullable`
 * already covers it, along with 3.0 `type` arrays and `type: null`.
 */
const ONLY_31_KEYWORDS = [
  "const",
  "prefixItems",
  "contentMediaType",
  "contentEncoding",
  "patternProperties",
  "propertyNames",
  "unevaluatedProperties",
  "unevaluatedItems",
  "dependentRequired",
  "dependentSchemas",
  "if",
  "then",
  "else",
  "$defs",
  "examples",
] as const;

const TYPE_NAMES_30 = new Set(["boolean", "object", "array", "number", "string", "integer"]);
const TYPE_NAMES_31 = new Set([...TYPE_NAMES_30, "null"]);

const NONNEG_INT_KEYS = ["minLength", "maxLength", "minItems", "maxItems", "minProperties", "maxProperties"] as const;
const RANGE_PAIRS = [
  ["minimum", "maximum"],
  ["minLength", "maxLength"],
  ["minItems", "maxItems"],
  ["minProperties", "maxProperties"],
] as const;

function isBooleanScalar(node: Node | undefined): boolean {
  return !!node && isScalar(node) && typeof node.value === "boolean";
}

function isNumberScalar(node: Node | undefined): boolean {
  return !!node && isScalar(node) && typeof node.value === "number";
}

function numberValue(node: Node | undefined): number | undefined {
  return node && isScalar(node) && typeof node.value === "number" ? node.value : undefined;
}

function stringValue(node: Node | undefined): string | undefined {
  return node && isScalar(node) && typeof node.value === "string" ? (node.value as string) : undefined;
}

function checkVersionOnlyKeywords(ctx: RuleContext, doc: OasisDocument, schema: Node): void {
  if (ctx.version !== "3.0") return;
  for (const key of ONLY_31_KEYWORDS) {
    const node = childAt(schema, key);
    if (node) {
      ctx.report({ doc, node }, `"${key}" is not supported in OpenAPI 3.0; it's a JSON Schema 2020-12 keyword available in OpenAPI 3.1.`);
    }
  }
}

function checkExclusive(ctx: RuleContext, doc: OasisDocument, schema: Node, key: "exclusiveMinimum" | "exclusiveMaximum"): void {
  const node = childAt(schema, key);
  if (!node || !isScalar(node)) return;
  if (ctx.version === "3.0" && typeof node.value === "number") {
    ctx.report({ doc, node }, `"${key}" must be a boolean in OpenAPI 3.0 (used alongside "minimum"/"maximum"); the numeric form is a 3.1 (JSON Schema 2020-12) feature.`);
  } else if (ctx.version === "3.1" && typeof node.value === "boolean") {
    ctx.report({ doc, node }, `"${key}" must be a number in OpenAPI 3.1 (JSON Schema 2020-12); the boolean form alongside "minimum"/"maximum" is OpenAPI 3.0.`);
  }
}

function checkType(ctx: RuleContext, doc: OasisDocument, schema: Node): void {
  const typeNode = childAt(schema, "type");
  if (!typeNode) return;

  if (ctx.version === "3.0") {
    if (isSeq(typeNode)) return; // "type" arrays in 3.0: flagged by structure/schema-nullable
    if (!isScalar(typeNode) || typeof typeNode.value !== "string") {
      ctx.report({ doc, node: typeNode }, '"type" must be a string in OpenAPI 3.0.');
      return;
    }
    if (typeNode.value === "null") return; // "type: null" in 3.0: flagged by structure/schema-nullable
    if (!TYPE_NAMES_30.has(typeNode.value)) {
      ctx.report({ doc, node: typeNode }, `"type: ${typeNode.value}" is not a valid Schema Object type in OpenAPI 3.0 (must be one of boolean, object, array, number, string, integer).`);
    }
    return;
  }

  if (ctx.version === "3.1") {
    if (isScalar(typeNode)) {
      if (typeof typeNode.value !== "string") {
        ctx.report({ doc, node: typeNode }, '"type" must be a string or array of strings in OpenAPI 3.1.');
      } else if (!TYPE_NAMES_31.has(typeNode.value)) {
        ctx.report({ doc, node: typeNode }, `"type: ${typeNode.value}" is not a valid JSON Schema type.`);
      }
      return;
    }
    if (isSeq(typeNode)) {
      const seenValues = new Set<string>();
      for (const item of typeNode.items) {
        if (!isNode(item) || !isScalar(item) || typeof item.value !== "string") {
          ctx.report({ doc, node: isNode(item) ? item : typeNode }, '"type" array entries must be strings.');
          continue;
        }
        if (!TYPE_NAMES_31.has(item.value)) {
          ctx.report({ doc, node: item }, `"type: ${item.value}" is not a valid JSON Schema type.`);
        }
        if (seenValues.has(item.value)) {
          ctx.report({ doc, node: item }, `"type" array contains duplicate entry "${item.value}".`);
        }
        seenValues.add(item.value);
      }
      return;
    }
    ctx.report({ doc, node: typeNode }, '"type" must be a string or array of strings in OpenAPI 3.1.');
  }
}

function checkNumerics(ctx: RuleContext, doc: OasisDocument, schema: Node): void {
  for (const key of ["minimum", "maximum"]) {
    const node = childAt(schema, key);
    if (node && !isNumberScalar(node)) {
      ctx.report({ doc, node }, `"${key}" must be a number.`);
    }
  }

  const multipleOf = childAt(schema, "multipleOf");
  if (multipleOf) {
    const value = numberValue(multipleOf);
    if (value === undefined) {
      ctx.report({ doc, node: multipleOf }, '"multipleOf" must be a number.');
    } else if (value <= 0) {
      ctx.report({ doc, node: multipleOf }, '"multipleOf" must be greater than 0.');
    }
  }

  for (const key of NONNEG_INT_KEYS) {
    const node = childAt(schema, key);
    if (!node) continue;
    const value = numberValue(node);
    if (value === undefined || !Number.isInteger(value) || value < 0) {
      ctx.report({ doc, node }, `"${key}" must be a non-negative integer.`);
    }
  }
}

function checkConsistency(ctx: RuleContext, doc: OasisDocument, schema: Node): void {
  for (const [minKey, maxKey] of RANGE_PAIRS) {
    const minNode = childAt(schema, minKey);
    const maxNode = childAt(schema, maxKey);
    const minValue = numberValue(minNode);
    const maxValue = numberValue(maxNode);
    if (minValue !== undefined && maxValue !== undefined && minValue > maxValue) {
      ctx.report(
        { doc, node: maxNode! },
        `"${minKey}" (${minValue}) is greater than "${maxKey}" (${maxValue}); this schema can never be satisfied.`,
      );
    }
  }

  const requiredNode = childAt(schema, "required");
  const propertiesNode = childAt(schema, "properties");
  const additionalProperties = childAt(schema, "additionalProperties");
  const additionalPropertiesIsFalse = !!additionalProperties && isScalar(additionalProperties) && additionalProperties.value === false;
  if (isSeq(requiredNode) && isMap(propertiesNode) && additionalPropertiesIsFalse) {
    const propertyNames = new Set(propertiesNode.items.map((p) => keyToString(p.key)));
    for (const item of requiredNode.items) {
      const name = stringValue(isNode(item) ? item : undefined);
      if (name !== undefined && !propertyNames.has(name)) {
        ctx.report(
          { doc, node: isNode(item) ? item : requiredNode },
          `"required" lists "${name}", but "additionalProperties: false" and "properties" does not define it; this schema can never be satisfied.`,
        );
      }
    }
  }
}

function checkPattern(ctx: RuleContext, doc: OasisDocument, schema: Node): void {
  const node = childAt(schema, "pattern");
  if (!node) return;
  if (!isScalar(node) || typeof node.value !== "string") {
    ctx.report({ doc, node }, '"pattern" must be a string.');
    return;
  }
  try {
    new RegExp(node.value);
  } catch {
    ctx.report({ doc, node }, `"pattern" is not a valid regular expression: "${node.value}".`);
  }
}

function checkRequired(ctx: RuleContext, doc: OasisDocument, schema: Node): void {
  const node = childAt(schema, "required");
  if (!node) return;
  if (!isSeq(node) || node.items.length === 0) {
    ctx.report({ doc, node }, '"required" must be a non-empty array of strings.');
    return;
  }
  const seen = new Set<string>();
  for (const item of node.items) {
    const value = stringValue(isNode(item) ? item : undefined);
    if (value === undefined) {
      ctx.report({ doc, node: isNode(item) ? item : node }, '"required" entries must be strings.');
      continue;
    }
    if (seen.has(value)) {
      ctx.report({ doc, node: isNode(item) ? item : node }, `"required" contains duplicate entry "${value}".`);
    }
    seen.add(value);
  }
}

function checkEnum(ctx: RuleContext, doc: OasisDocument, schema: Node): void {
  const node = childAt(schema, "enum");
  if (node && (!isSeq(node) || node.items.length === 0)) {
    ctx.report({ doc, node }, '"enum" must be a non-empty array.');
  }
}

function checkItems(ctx: RuleContext, doc: OasisDocument, schema: Node): void {
  const node = childAt(schema, "items");
  if (!node) return;
  if (isSeq(node)) {
    ctx.report(
      { doc, node },
      ctx.version === "3.0"
        ? '"items" must be a single schema object in OpenAPI 3.0; tuple-typed arrays are not supported.'
        : '"items" must be a single schema object in OpenAPI 3.1; use "prefixItems" for tuple validation.',
    );
    return;
  }
  if (!isMap(node)) {
    ctx.report({ doc, node }, '"items" must be a schema object.');
  }
}

function checkPropertiesShape(ctx: RuleContext, doc: OasisDocument, schema: Node): void {
  const properties = childAt(schema, "properties");
  if (properties && !isMap(properties)) {
    ctx.report({ doc, node: properties }, '"properties" must be an object.');
  }

  const additionalProperties = childAt(schema, "additionalProperties");
  if (additionalProperties && !isBooleanScalar(additionalProperties) && !isMap(additionalProperties)) {
    ctx.report({ doc, node: additionalProperties }, '"additionalProperties" must be a boolean or a schema object.');
  }
}

function checkFormat(ctx: RuleContext, doc: OasisDocument, schema: Node): void {
  const node = childAt(schema, "format");
  if (node && (!isScalar(node) || typeof node.value !== "string")) {
    ctx.report({ doc, node }, '"format" must be a string.');
  }
}

function checkRefSiblings(ctx: RuleContext, doc: OasisDocument, schema: Node): void {
  if (ctx.version !== "3.0" || !isMap(schema) || !isRefObject(schema)) return;
  const siblingKeys = schema.items.map((pair) => keyToString(pair.key)).filter((key) => key !== "$ref");
  if (siblingKeys.length === 0) return;
  ctx.report(
    { doc, node: schema },
    `Sibling keys alongside "$ref" (${siblingKeys.map((k) => `"${k}"`).join(", ")}) are ignored in OpenAPI 3.0 Reference Objects; move them to the referenced schema or remove the $ref.`,
  );
}

function checkSchema(ctx: RuleContext, doc: OasisDocument, schema: Node): void {
  if (!isMap(schema)) return;
  checkVersionOnlyKeywords(ctx, doc, schema);
  checkExclusive(ctx, doc, schema, "exclusiveMinimum");
  checkExclusive(ctx, doc, schema, "exclusiveMaximum");
  checkType(ctx, doc, schema);
  checkNumerics(ctx, doc, schema);
  checkConsistency(ctx, doc, schema);
  checkPattern(ctx, doc, schema);
  checkRequired(ctx, doc, schema);
  checkEnum(ctx, doc, schema);
  checkItems(ctx, doc, schema);
  checkPropertiesShape(ctx, doc, schema);
  checkFormat(ctx, doc, schema);
  checkRefSiblings(ctx, doc, schema);
}

export const structureSchemaKeywords: Rule = {
  name: "structure/schema-keywords",
  description:
    "Validates Schema Object keywords against the document's dialect (OpenAPI 3.0's restricted subset vs 3.1's JSON Schema 2020-12), value types (type, numeric bounds, pattern, required, enum, items, properties, additionalProperties, format), internal consistency (min/max contradictions, required properties excluded by additionalProperties: false), and $ref sibling handling.",
  defaultSeverity: "error",
  check(ctx) {
    if (ctx.version !== "3.0" && ctx.version !== "3.1") return;

    const seen = new Set<Node>();
    for (const site of iterateSchemas(ctx.graph, ctx.entryDoc, ctx.documents, ctx.version)) {
      walkSchemaTree(
        site.node,
        (schema) => checkSchema(ctx, site.doc, schema),
        { version: ctx.version, prefixItems: true, patternProperties: true, not: true, ifThenElse: true, defs: true },
        seen,
      );
    }
  },
};
