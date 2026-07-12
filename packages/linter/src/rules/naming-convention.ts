import { isMap, isNode, isScalar, isSeq } from "yaml";
import type { Node } from "yaml";
import type { OasisDocument } from "@oasis/core";
import { iterateOperations, iteratePathItems, iterateSchemas } from "../openapi-walk.ts";
import { childAt, keyToString, resolveMaybeRef } from "../util.ts";
import type { Rule, RuleContext } from "../types.ts";

/** Supported casing styles for the `naming-convention` rule's options. */
export const CASING_STYLES = ["camelCase", "PascalCase", "snake_case", "kebab-case", "SCREAMING_SNAKE_CASE"] as const;
export type CasingStyle = (typeof CASING_STYLES)[number];

const OPTION_KEYS = ["operationId", "componentName", "parameterName", "propertyName"] as const;
type OptionKey = (typeof OPTION_KEYS)[number];

export type NamingConventionOptions = Partial<Record<OptionKey, CasingStyle>>;

/** Groups under `components/*` (and, in 3.1, `components/pathItems`) whose keys name a component. */
const COMPONENT_CATEGORIES = [
  "schemas",
  "responses",
  "parameters",
  "examples",
  "requestBodies",
  "headers",
  "securitySchemes",
  "links",
  "callbacks",
  "pathItems",
] as const;

/**
 * Checks whether `name` matches `style`. Pragmatic, not a strict grammar: a lone word (no
 * separators) satisfies every style that doesn't require a specific first-letter case, and
 * digits are allowed to lead/trail a word or segment since that's how real-world names look
 * ("oauth2Token", "v2_id"). What's rejected is separators/casing inconsistent with the style
 * itself (an underscore in camelCase, an uppercase letter in snake_case, etc).
 */
export function matchesCase(name: string, style: CasingStyle): boolean {
  if (name === "") return false;
  switch (style) {
    case "camelCase":
      return /^[a-z][a-zA-Z0-9]*$/.test(name);
    case "PascalCase":
      return /^[A-Z][a-zA-Z0-9]*$/.test(name);
    case "snake_case":
      return /^[a-z0-9]+(_[a-z0-9]+)*$/.test(name);
    case "kebab-case":
      return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name);
    case "SCREAMING_SNAKE_CASE":
      return /^[A-Z0-9]+(_[A-Z0-9]+)*$/.test(name);
  }
}

function checkOperationIds(ctx: RuleContext, style: CasingStyle): void {
  for (const op of iterateOperations(ctx.graph, ctx.entryDoc, ctx.version)) {
    const idNode = childAt(op.node, "operationId");
    if (!idNode || !isScalar(idNode) || typeof idNode.value !== "string" || idNode.value === "") continue;

    const id = idNode.value;
    if (!matchesCase(id, style)) {
      const label = `${op.method.toUpperCase()} ${op.pathItem.template}`;
      ctx.report({ doc: op.doc, node: idNode }, `Operation "${label}" operationId "${id}" is not ${style}.`);
    }
  }
}

function checkComponentNames(ctx: RuleContext, style: CasingStyle): void {
  for (const doc of ctx.documents) {
    const root = doc.yamlDoc.contents;
    if (!root || !isMap(root)) continue;
    const componentsNode = childAt(root, "components");
    if (!componentsNode || !isMap(componentsNode)) continue;

    for (const category of COMPONENT_CATEGORIES) {
      const categoryNode = childAt(componentsNode, category);
      if (!categoryNode || !isMap(categoryNode)) continue;

      for (const pair of categoryNode.items) {
        const name = keyToString(pair.key);
        if (!matchesCase(name, style)) {
          ctx.report(
            { doc, node: isNode(pair.key) ? pair.key : categoryNode },
            `Component "${name}" in "components/${category}" is not ${style}.`,
          );
        }
      }
    }
  }
}

interface ParameterObject {
  doc: OasisDocument;
  node: Node;
}

/**
 * Collect every parameter object reachable from path items, operations, and `components/parameters`,
 * deduplicated by resolved location so a parameter shared via `$ref` across several operations (or
 * also registered under `components/parameters`) is only checked once.
 */
function collectParameterObjects(ctx: RuleContext): ParameterObject[] {
  const seen = new Set<string>();
  const results: ParameterObject[] = [];

  function addFromArray(doc: OasisDocument, arrNode: Node | undefined, pointerPrefix: string): void {
    if (!arrNode || !isSeq(arrNode)) return;
    arrNode.items.forEach((item, i) => {
      if (!isNode(item)) return;
      const resolved = resolveMaybeRef(ctx.graph, doc, item, `${pointerPrefix}/${i}`);
      if (!isMap(resolved.node)) return;
      const key = `${resolved.doc.filePath}::${resolved.pointer}`;
      if (seen.has(key)) return;
      seen.add(key);
      results.push({ doc: resolved.doc, node: resolved.node });
    });
  }

  for (const pathItem of iteratePathItems(ctx.graph, ctx.entryDoc, ctx.version)) {
    if (!isMap(pathItem.node)) continue;
    addFromArray(pathItem.doc, childAt(pathItem.node, "parameters"), `${pathItem.pointer}/parameters`);
  }
  for (const op of iterateOperations(ctx.graph, ctx.entryDoc, ctx.version)) {
    if (!isMap(op.node)) continue;
    addFromArray(op.doc, childAt(op.node, "parameters"), `${op.pointer}/parameters`);
  }
  for (const doc of ctx.documents) {
    const root = doc.yamlDoc.contents;
    if (!root || !isMap(root)) continue;
    const componentsNode = childAt(root, "components");
    if (!componentsNode || !isMap(componentsNode)) continue;
    const parametersNode = childAt(componentsNode, "parameters");
    if (!parametersNode || !isMap(parametersNode)) continue;

    for (const pair of parametersNode.items) {
      const name = keyToString(pair.key);
      if (!isNode(pair.value) || !isMap(pair.value)) continue;
      const pointer = `/components/parameters/${name}`;
      const key = `${doc.filePath}::${pointer}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({ doc, node: pair.value });
    }
  }

  return results;
}

function checkParameterNames(ctx: RuleContext, style: CasingStyle): void {
  for (const param of collectParameterObjects(ctx)) {
    // HTTP header names are conventionally kebab/mixed case and case-insensitive on the wire, so
    // "in: header" parameters are exempt from the configured style.
    const inNode = childAt(param.node, "in");
    if (isScalar(inNode) && inNode.value === "header") continue;

    const nameNode = childAt(param.node, "name");
    if (!nameNode || !isScalar(nameNode) || typeof nameNode.value !== "string" || nameNode.value === "") continue;

    const name = nameNode.value;
    if (!matchesCase(name, style)) {
      ctx.report({ doc: param.doc, node: nameNode }, `Parameter "${name}" is not ${style}.`);
    }
  }
}

/**
 * Recursively visit schema-shaped nodes reachable from `node` via properties/items/allOf/oneOf/
 * anyOf/additionalProperties (mirrors `structure/schema-nullable`'s walk). `patternProperties`
 * (3.1) is deliberately not traversed: its keys are regexes, not property names.
 */
function walkSchemas(node: Node, visit: (schema: Node) => void, seen: Set<Node> = new Set()): void {
  if (!isMap(node) || seen.has(node)) return;
  seen.add(node);
  visit(node);

  const properties = childAt(node, "properties");
  if (isMap(properties)) {
    for (const pair of properties.items) {
      if (isNode(pair.value)) walkSchemas(pair.value, visit, seen);
    }
  }

  const items = childAt(node, "items");
  if (isNode(items)) walkSchemas(items, visit, seen);

  const additionalProperties = childAt(node, "additionalProperties");
  if (isNode(additionalProperties)) walkSchemas(additionalProperties, visit, seen);

  for (const key of ["allOf", "oneOf", "anyOf"]) {
    const seq = childAt(node, key);
    if (isSeq(seq)) {
      for (const item of seq.items) {
        if (isNode(item)) walkSchemas(item, visit, seen);
      }
    }
  }
}

function checkPropertyNames(ctx: RuleContext, style: CasingStyle): void {
  const seen = new Set<Node>();
  for (const site of iterateSchemas(ctx.graph, ctx.entryDoc, ctx.documents, ctx.version)) {
    walkSchemas(
      site.node,
      (schema) => {
        const properties = childAt(schema, "properties");
        if (!isMap(properties)) return;
        for (const propPair of properties.items) {
          const name = keyToString(propPair.key);
          if (!matchesCase(name, style)) {
            ctx.report(
              { doc: site.doc, node: isNode(propPair.key) ? propPair.key : properties },
              `Property "${name}" is not ${style}.`,
            );
          }
        }
      },
      seen,
    );
  }
}

export const namingConvention: Rule = {
  name: "naming-convention",
  description:
    'Configurable casing checks (operationId, component names, parameter names, schema property names). Off by default: does nothing unless configured with an options object naming at least one target.',
  defaultSeverity: "off",
  defaultOptions: {} satisfies NamingConventionOptions,
  validateOptions(options) {
    if (typeof options !== "object" || options === null || Array.isArray(options)) {
      return "expected an object";
    }
    for (const [key, value] of Object.entries(options)) {
      if (!(OPTION_KEYS as readonly string[]).includes(key)) {
        return `unknown option "${key}"; expected one of ${OPTION_KEYS.join(", ")}`;
      }
      if (typeof value !== "string") {
        return `option "${key}" must be a string casing style`;
      }
      if (!(CASING_STYLES as readonly string[]).includes(value)) {
        return `option "${key}" has invalid casing style "${value}"; expected one of ${CASING_STYLES.join(", ")}`;
      }
    }
    return undefined;
  },
  check(ctx) {
    const options = (ctx.options ?? {}) as NamingConventionOptions;
    if (options.operationId) checkOperationIds(ctx, options.operationId);
    if (options.componentName) checkComponentNames(ctx, options.componentName);
    if (options.parameterName) checkParameterNames(ctx, options.parameterName);
    if (options.propertyName) checkPropertyNames(ctx, options.propertyName);
  },
};
