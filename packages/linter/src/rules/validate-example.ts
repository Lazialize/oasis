import { isMap, isNode, isScalar, isSeq } from "yaml";
import type { Node } from "yaml";
import { foundRefForNode, resolveAlias, resolveRef } from "@oasis/core";
import type { OasisDocument, OpenApiVersion, WorkspaceGraph } from "@oasis/core";
import { childAt, keyToString } from "../util.ts";

/**
 * A small, honest subset of JSON Schema / OpenAPI Schema Object validation, hand-rolled rather
 * than pulled in as a dependency (keeps the binary lean). It deliberately favors false negatives
 * over false positives: anything it can't confidently evaluate (schemas using `not`,
 * `discriminator`, or an unresolved `$ref`) is skipped rather than guessed at.
 *
 * Keywords checked: `type` (version-aware: 3.0 `nullable` vs 3.1 type arrays / `"null"`), `enum`,
 * `const` (3.1), `required`/`properties`, `patternProperties` (3.1),
 * `additionalProperties: false` (and, if it's itself a schema, validation against it),
 * `items` (+ 3.1 `prefixItems`), `minItems`/`maxItems`,
 * `minimum`/`maximum`/`exclusiveMinimum`/`exclusiveMaximum` (version-aware boolean vs numeric
 * exclusive bounds), `minLength`/`maxLength`/`pattern`, `allOf` (all branches), `oneOf`/`anyOf`
 * (at least one branch, not enforcing `oneOf` exclusivity).
 *
 * `unevaluatedProperties` is deliberately NOT evaluated: correct 2020-12 semantics require
 * tracking which properties were evaluated by *any* in-place applicator (allOf/oneOf/anyOf/
 * if-then-else, plus properties/patternProperties), which this subset validator doesn't model.
 * Skipping it keeps to the false-negatives-over-false-positives policy. Note that a property
 * matched only by `patternProperties` counts as evaluated for 2020-12 purposes, so any future
 * `unevaluatedProperties` support must include pattern matches in the evaluated set.
 */

export interface SchemaLoc {
  doc: OasisDocument;
  node: Node;
}

export interface ExampleFailure {
  /** The node the diagnostic should point at: the invalid example value, or the violated schema keyword. */
  node: Node;
  /**
   * The document that owns `node`. A failure pointing at a schema keyword (a violated
   * `minLength`, bound, or pattern) may live in a different file than the example being
   * validated; converting its range with the example document's line index would point at
   * unrelated text.
   */
  doc: OasisDocument;
  message: string;
}

export interface ValidateEnv {
  graph: WorkspaceGraph;
  version: OpenApiVersion;
}

/**
 * Follow a `$ref` chain on a schema node until a concrete (non-`$ref`) schema is reached. Returns
 * `"unresolved"` if a link can't be followed or if a Reference Object recurs on the chain (a cycle);
 * there is no fixed hop limit, so an acyclic chain of any length resolves fully.
 */
function resolveSchema(env: ValidateEnv, loc: SchemaLoc): SchemaLoc | "unresolved" {
  let current = loc;
  const visited = new Set<Node>();
  for (;;) {
    if (!isMap(current.node)) return current;
    const refPair = current.node.items.find((p) => keyToString(p.key) === "$ref");
    if (!refPair) return current;
    const refValue = isNode(refPair.value)
      ? resolveAlias(refPair.value, current.doc.yamlDoc) ?? refPair.value
      : undefined;
    if (!isScalar(refValue) || typeof refValue.value !== "string") return "unresolved";
    if (visited.has(current.node)) return "unresolved";
    visited.add(current.node);
    const contextualRef = foundRefForNode(env.graph, current.doc, refValue);
    if (!contextualRef) return "unresolved";
    const result = resolveRef(env.graph, current.doc, contextualRef);
    if (!result.ok) return "unresolved";
    current = { doc: result.doc, node: result.node };
  }
}

function toPlain(node: Node | undefined): unknown {
  if (!node) return undefined;
  if (isScalar(node)) return node.value;
  if (isSeq(node)) return node.items.filter(isNode).map(toPlain);
  if (isMap(node)) {
    const obj: Record<string, unknown> = {};
    for (const pair of node.items) {
      if (!isNode(pair.value)) continue;
      obj[keyToString(pair.key)] = toPlain(pair.value);
    }
    return obj;
  }
  return undefined;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    const aKeys = Object.keys(a as Record<string, unknown>);
    const bKeys = Object.keys(b as Record<string, unknown>);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false;
}

function numberOf(node: Node | undefined): number | undefined {
  return isScalar(node) && typeof node.value === "number" ? node.value : undefined;
}

/** Describes the JSON-Schema-ish "type" of an example value node. */
function typeLabel(node: Node): string {
  if (isMap(node)) return "object";
  if (isSeq(node)) return "array";
  if (isScalar(node)) {
    const v = node.value;
    if (v === null) return "null";
    if (typeof v === "boolean") return "boolean";
    if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
    if (typeof v === "string") return "string";
  }
  return "unknown";
}

function allowedTypes(schema: Node, version: OpenApiVersion): string[] | undefined {
  const typeNode = childAt(schema, "type");
  let types: string[] | undefined;
  if (isScalar(typeNode) && typeof typeNode.value === "string") {
    types = [typeNode.value];
  } else if (isSeq(typeNode)) {
    const items: string[] = [];
    for (const item of typeNode.items) {
      if (isNode(item) && isScalar(item) && typeof item.value === "string") items.push(item.value);
    }
    if (items.length > 0) types = items;
  }
  if (!types) return undefined;

  if (version === "3.0") {
    const nullableNode = childAt(schema, "nullable");
    if (isScalar(nullableNode) && nullableNode.value === true) types = [...types, "null"];
  }
  return types;
}

function typeMatches(expected: string, actual: string): boolean {
  if (expected === "integer") return actual === "integer";
  if (expected === "number") return actual === "integer" || actual === "number";
  return expected === actual;
}

function withLoc(reason: string, path: string): string {
  return path === "" ? reason : `${reason} at ${path}`;
}

function checkType(schema: Node, exampleDoc: OasisDocument, exampleNode: Node, version: OpenApiVersion, path: string): ExampleFailure[] {
  const types = allowedTypes(schema, version);
  if (!types) return [];
  const actual = typeLabel(exampleNode);
  if (types.some((t) => typeMatches(t, actual))) return [];
  const typesStr = types.map((t) => `"${t}"`).join(" or ");
  const reason = path === "" ? `expected type ${typesStr}, got ${actual}` : `expected type ${typesStr} at ${path}, got ${actual}`;
  return [{ node: exampleNode, doc: exampleDoc, message: reason }];
}

function checkEnumConst(schema: Node, exampleDoc: OasisDocument, exampleNode: Node, path: string): ExampleFailure[] {
  const failures: ExampleFailure[] = [];
  const value = toPlain(exampleNode);

  const enumNode = childAt(schema, "enum");
  if (isSeq(enumNode)) {
    const ok = enumNode.items.some((item) => isNode(item) && deepEqual(toPlain(item), value));
    if (!ok) failures.push({ node: exampleNode, doc: exampleDoc, message: withLoc("value does not match any \"enum\" member", path) });
  }

  const constNode = childAt(schema, "const");
  if (constNode && isNode(constNode)) {
    if (!deepEqual(toPlain(constNode), value)) {
      failures.push({ node: exampleNode, doc: exampleDoc, message: withLoc('value does not match "const"', path) });
    }
  }

  return failures;
}

function checkNumericBounds(schemaDoc: OasisDocument, schema: Node, value: number, version: OpenApiVersion, path: string): ExampleFailure[] {
  const failures: ExampleFailure[] = [];
  const minimum = numberOf(childAt(schema, "minimum"));
  const maximum = numberOf(childAt(schema, "maximum"));
  const exclusiveMinNode = childAt(schema, "exclusiveMinimum");
  const exclusiveMaxNode = childAt(schema, "exclusiveMaximum");

  if (version === "3.0") {
    const exclusiveMin = isScalar(exclusiveMinNode) && exclusiveMinNode.value === true;
    const exclusiveMax = isScalar(exclusiveMaxNode) && exclusiveMaxNode.value === true;
    if (minimum !== undefined && (exclusiveMin ? value <= minimum : value < minimum)) {
      failures.push({ node: schema, doc: schemaDoc, message: withLoc(`value ${value} is below minimum ${minimum}${exclusiveMin ? " (exclusive)" : ""}`, path) });
    }
    if (maximum !== undefined && (exclusiveMax ? value >= maximum : value > maximum)) {
      failures.push({ node: schema, doc: schemaDoc, message: withLoc(`value ${value} is above maximum ${maximum}${exclusiveMax ? " (exclusive)" : ""}`, path) });
    }
  } else {
    if (minimum !== undefined && value < minimum) {
      failures.push({ node: schema, doc: schemaDoc, message: withLoc(`value ${value} is below minimum ${minimum}`, path) });
    }
    if (maximum !== undefined && value > maximum) {
      failures.push({ node: schema, doc: schemaDoc, message: withLoc(`value ${value} is above maximum ${maximum}`, path) });
    }
    const exclusiveMin = numberOf(exclusiveMinNode);
    const exclusiveMax = numberOf(exclusiveMaxNode);
    if (exclusiveMin !== undefined && value <= exclusiveMin) {
      failures.push({ node: schema, doc: schemaDoc, message: withLoc(`value ${value} is below exclusiveMinimum ${exclusiveMin}`, path) });
    }
    if (exclusiveMax !== undefined && value >= exclusiveMax) {
      failures.push({ node: schema, doc: schemaDoc, message: withLoc(`value ${value} is above exclusiveMaximum ${exclusiveMax}`, path) });
    }
  }
  return failures;
}

/**
 * The length of `value` in Unicode code points, as JSON Schema's `minLength`/`maxLength` define
 * string length — NOT UTF-16 code units (`String.length`), under which a supplementary-plane
 * character (an emoji, a rare CJK ideograph) counts as 2. Iterating the string walks code points
 * without allocating an intermediate array.
 */
function codePointLength(value: string): number {
  let count = 0;
  for (let i = 0; i < value.length; i++) {
    count++;
    const code = value.charCodeAt(i);
    // A high surrogate followed by a low surrogate is one code point spanning two units.
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) i++;
    }
  }
  return count;
}

function checkStringConstraints(schemaDoc: OasisDocument, schema: Node, value: string, path: string): ExampleFailure[] {
  const failures: ExampleFailure[] = [];
  const minLength = numberOf(childAt(schema, "minLength"));
  const maxLength = numberOf(childAt(schema, "maxLength"));
  const length = minLength !== undefined || maxLength !== undefined ? codePointLength(value) : 0;
  if (minLength !== undefined && length < minLength) {
    failures.push({ node: schema, doc: schemaDoc, message: withLoc(`string length ${length} is below minLength ${minLength}`, path) });
  }
  if (maxLength !== undefined && length > maxLength) {
    failures.push({ node: schema, doc: schemaDoc, message: withLoc(`string length ${length} is above maxLength ${maxLength}`, path) });
  }
  const patternNode = childAt(schema, "pattern");
  if (isScalar(patternNode) && typeof patternNode.value === "string") {
    try {
      const re = new RegExp(patternNode.value);
      if (!re.test(value)) {
        failures.push({ node: schema, doc: schemaDoc, message: withLoc(`string does not match pattern "${patternNode.value}"`, path) });
      }
    } catch {
      // Invalid/unsupported regex syntax: skip rather than false-positive.
    }
  }
  return failures;
}

function checkScalarConstraints(schemaDoc: OasisDocument, schema: Node, exampleNode: Node, version: OpenApiVersion, path: string): ExampleFailure[] {
  if (!isScalar(exampleNode)) return [];
  const v = exampleNode.value;
  if (typeof v === "number") return checkNumericBounds(schemaDoc, schema, v, version, path);
  if (typeof v === "string") return checkStringConstraints(schemaDoc, schema, v, path);
  return [];
}

function checkObject(
  env: ValidateEnv,
  doc: OasisDocument,
  schema: Node,
  exampleDoc: OasisDocument,
  exampleNode: Node,
  path: string,
  chain: Set<Node>,
  extraKnownProps: Set<string> = new Set(),
): ExampleFailure[] {
  if (!isMap(exampleNode)) return [];
  const failures: ExampleFailure[] = [];
  const exampleKeys = new Set(exampleNode.items.map((p) => keyToString(p.key)));

  const requiredNode = childAt(schema, "required");
  if (isSeq(requiredNode)) {
    for (const item of requiredNode.items) {
      if (isNode(item) && isScalar(item) && typeof item.value === "string" && !exampleKeys.has(item.value)) {
        failures.push({ node: exampleNode, doc: exampleDoc, message: withLoc(`missing required property "${item.value}"`, path) });
      }
    }
  }

  const propertiesNode = childAt(schema, "properties");
  const knownProps = new Set<string>(extraKnownProps);
  if (isMap(propertiesNode)) {
    for (const pair of propertiesNode.items) {
      const propName = keyToString(pair.key);
      knownProps.add(propName);
      if (!isNode(pair.value)) continue;
      const examplePair = exampleNode.items.find((p) => keyToString(p.key) === propName);
      if (!examplePair || !isNode(examplePair.value)) continue;
      failures.push(...checkSchema(env, { doc, node: pair.value }, exampleDoc, examplePair.value, chain, `${path}/${propName}`));
    }
  }

  // (3.1) `patternProperties`: a property matching any pattern is validated against every matching
  // schema, and counts as matched — `additionalProperties` then only applies to properties matched
  // by neither `properties` nor `patternProperties`. Compiled patterns that aren't valid JS regexes
  // are skipped (no crash, no false positive) but conservatively treated as matching nothing.
  const patternMatched = new Set<string>();
  const patternPropertiesNode = env.version === "3.1" ? childAt(schema, "patternProperties") : undefined;
  if (isMap(patternPropertiesNode)) {
    const patterns: { re: RegExp; schema: Node }[] = [];
    for (const pair of patternPropertiesNode.items) {
      if (!isNode(pair.value)) continue;
      try {
        patterns.push({ re: new RegExp(keyToString(pair.key)), schema: pair.value });
      } catch {
        // Invalid/unsupported regex syntax: skip this pattern.
      }
    }
    for (const pair of exampleNode.items) {
      const name = keyToString(pair.key);
      if (!isNode(pair.value)) continue;
      for (const { re, schema: patternSchema } of patterns) {
        if (!re.test(name)) continue;
        patternMatched.add(name);
        failures.push(...checkSchema(env, { doc, node: patternSchema }, exampleDoc, pair.value, chain, `${path}/${name}`));
      }
    }
  }

  const additionalPropertiesNode = childAt(schema, "additionalProperties");
  if (additionalPropertiesNode) {
    if (isScalar(additionalPropertiesNode) && additionalPropertiesNode.value === false) {
      for (const pair of exampleNode.items) {
        const name = keyToString(pair.key);
        if (!knownProps.has(name) && !patternMatched.has(name)) {
          failures.push({
            node: isNode(pair.key) ? pair.key : exampleNode,
            doc: exampleDoc,
            message: withLoc(`unexpected property "${name}" (additionalProperties: false)`, path),
          });
        }
      }
    } else if (isMap(additionalPropertiesNode)) {
      for (const pair of exampleNode.items) {
        const name = keyToString(pair.key);
        if (knownProps.has(name) || patternMatched.has(name) || !isNode(pair.value)) continue;
        failures.push(...checkSchema(env, { doc, node: additionalPropertiesNode }, exampleDoc, pair.value, chain, `${path}/${name}`));
      }
    }
  }

  return failures;
}

function checkArray(env: ValidateEnv, doc: OasisDocument, schema: Node, exampleDoc: OasisDocument, exampleNode: Node, path: string, chain: Set<Node>): ExampleFailure[] {
  if (!isSeq(exampleNode)) return [];
  const failures: ExampleFailure[] = [];

  const minItems = numberOf(childAt(schema, "minItems"));
  const maxItems = numberOf(childAt(schema, "maxItems"));
  if (minItems !== undefined && exampleNode.items.length < minItems) {
    failures.push({ node: exampleNode, doc: exampleDoc, message: withLoc(`array has ${exampleNode.items.length} items, below minItems ${minItems}`, path) });
  }
  if (maxItems !== undefined && exampleNode.items.length > maxItems) {
    failures.push({ node: exampleNode, doc: exampleDoc, message: withLoc(`array has ${exampleNode.items.length} items, above maxItems ${maxItems}`, path) });
  }

  let startIdx = 0;
  const prefixItemsNode = env.version === "3.1" ? childAt(schema, "prefixItems") : undefined;
  if (isSeq(prefixItemsNode)) {
    for (let i = 0; i < prefixItemsNode.items.length; i++) {
      const itemExample = exampleNode.items[i];
      if (!itemExample || !isNode(itemExample)) break;
      const itemSchema = prefixItemsNode.items[i];
      if (!isNode(itemSchema)) continue;
      failures.push(...checkSchema(env, { doc, node: itemSchema }, exampleDoc, itemExample, chain, `${path}/${i}`));
    }
    startIdx = prefixItemsNode.items.length;
  }

  const itemsNode = childAt(schema, "items");
  if (itemsNode && isNode(itemsNode)) {
    for (let i = startIdx; i < exampleNode.items.length; i++) {
      const itemExample = exampleNode.items[i];
      if (!isNode(itemExample)) continue;
      failures.push(...checkSchema(env, { doc, node: itemsNode }, exampleDoc, itemExample, chain, `${path}/${i}`));
    }
  }

  return failures;
}

/**
 * Collect the union of `properties` keys declared across every `allOf` branch (resolving `$ref`s
 * and recursing into nested `allOf`s, bounded depth to guard against pathological/cyclic input).
 * Used so that a branch's own `additionalProperties: false` doesn't false-positive on properties
 * legitimately contributed by sibling branches — the common "inherit a base via allOf" idiom that
 * real JSON Schema validators (which combine allOf structurally) accept.
 */
function collectAllOfPropertyNames(env: ValidateEnv, doc: OasisDocument, allOfNode: Node, seen: Set<Node> = new Set()): Set<string> {
  const names = new Set<string>();
  if (!isSeq(allOfNode) || seen.has(allOfNode)) return names;
  seen.add(allOfNode);
  for (const item of allOfNode.items) {
    if (!isNode(item)) continue;
    const resolved = resolveSchema(env, { doc, node: item });
    if (resolved === "unresolved" || !isMap(resolved.node)) continue;

    const propertiesNode = childAt(resolved.node, "properties");
    if (isMap(propertiesNode)) {
      for (const pair of propertiesNode.items) names.add(keyToString(pair.key));
    }

    const nestedAllOf = childAt(resolved.node, "allOf");
    if (isSeq(nestedAllOf)) {
      for (const name of collectAllOfPropertyNames(env, resolved.doc, nestedAllOf, seen)) names.add(name);
    }
  }
  return names;
}

function checkAllOf(env: ValidateEnv, doc: OasisDocument, schema: Node, exampleDoc: OasisDocument, exampleNode: Node, path: string, chain: Set<Node>): ExampleFailure[] {
  const allOfNode = childAt(schema, "allOf");
  if (!isSeq(allOfNode)) return [];
  const failures: ExampleFailure[] = [];
  const siblingProps = collectAllOfPropertyNames(env, doc, allOfNode);
  for (const item of allOfNode.items) {
    if (!isNode(item)) continue;
    failures.push(...checkSchema(env, { doc, node: item }, exampleDoc, exampleNode, chain, path, siblingProps));
  }
  return failures;
}

function checkOneAnyOf(env: ValidateEnv, doc: OasisDocument, schema: Node, exampleDoc: OasisDocument, exampleNode: Node, path: string, chain: Set<Node>): ExampleFailure[] {
  const failures: ExampleFailure[] = [];
  for (const key of ["oneOf", "anyOf"] as const) {
    const seq = childAt(schema, key);
    if (!isSeq(seq) || seq.items.length === 0) continue;
    const branches = seq.items.filter(isNode);
    if (branches.length === 0) continue;
    const anyPass = branches.some((branch) => checkSchema(env, { doc, node: branch }, exampleDoc, exampleNode, chain, path).length === 0);
    if (!anyPass) {
      failures.push({ node: exampleNode, doc: exampleDoc, message: withLoc(`value does not match any "${key}" branch (${branches.length} tried)`, path) });
    }
  }
  return failures;
}

function checkSchema(
  env: ValidateEnv,
  schemaLoc: SchemaLoc,
  exampleDoc: OasisDocument,
  exampleNode: Node,
  chain: Set<Node>,
  path: string,
  extraKnownProps: Set<string> = new Set(),
): ExampleFailure[] {
  const resolved = resolveSchema(env, schemaLoc);
  if (resolved === "unresolved") return [];
  const { doc, node: schema } = resolved;

  if (isScalar(schema)) {
    // JSON Schema boolean schemas: `true` always passes, `false` never does.
    if (schema.value === false) return [{ node: exampleNode, doc: exampleDoc, message: withLoc("no value satisfies a `false` schema", path) }];
    return [];
  }
  if (!isMap(schema)) return [];

  // Can't confidently evaluate these: skip rather than risk a false positive.
  if (childAt(schema, "not")) return [];
  if (childAt(schema, "discriminator")) return [];

  if (chain.has(schema)) return [];
  chain.add(schema);
  try {
    const typeFailures = checkType(schema, exampleDoc, exampleNode, env.version, path);
    if (typeFailures.length > 0) return typeFailures;

    const failures: ExampleFailure[] = [];
    failures.push(...checkEnumConst(schema, exampleDoc, exampleNode, path));
    failures.push(...checkScalarConstraints(doc, schema, exampleNode, env.version, path));
    failures.push(...checkObject(env, doc, schema, exampleDoc, exampleNode, path, chain, extraKnownProps));
    failures.push(...checkArray(env, doc, schema, exampleDoc, exampleNode, path, chain));
    failures.push(...checkAllOf(env, doc, schema, exampleDoc, exampleNode, path, chain));
    failures.push(...checkOneAnyOf(env, doc, schema, exampleDoc, exampleNode, path, chain));
    return failures;
  } finally {
    chain.delete(schema);
  }
}

/**
 * Validate `exampleNode` (owned by `exampleDoc`) against the schema at `schemaLoc` (following
 * `$ref`s as needed). Each failure carries the document owning its `node` — the example document
 * for failures pointing at the example value, or the schema's own document for failures pointing
 * at a violated schema keyword (which may live in a different file).
 */
export function validateExample(env: ValidateEnv, schemaLoc: SchemaLoc, exampleDoc: OasisDocument, exampleNode: Node): ExampleFailure[] {
  return checkSchema(env, schemaLoc, exampleDoc, exampleNode, new Set(), "");
}
