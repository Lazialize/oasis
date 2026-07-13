import { isMap, isNode, isScalar } from "yaml";
import type { Node } from "yaml";
import type { OasisDocument } from "@oasis/core";
import { collectParameterObjects, iterateOperations, iterateSchemas, walkSchemaTree } from "../openapi-walk.ts";
import { childAt, keyToString } from "../util.ts";
import type { Rule, RuleContext } from "../types.ts";

/** Supported casing styles for the `style/naming-convention` rule's options. */
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

function optionsForDoc(ctx: RuleContext, doc: OasisDocument): NamingConventionOptions {
  return (ctx.optionsFor(doc.filePath) ?? {}) as NamingConventionOptions;
}

function checkOperationIds(ctx: RuleContext): void {
  for (const op of iterateOperations(ctx.graph, ctx.entryDoc, ctx.version)) {
    const style = optionsForDoc(ctx, op.doc).operationId;
    if (!style) continue;

    const idNode = childAt(op.node, "operationId");
    if (!idNode || !isScalar(idNode) || typeof idNode.value !== "string" || idNode.value === "") continue;

    const id = idNode.value;
    if (!matchesCase(id, style)) {
      const label = `${op.method.toUpperCase()} ${op.pathItem.template}`;
      ctx.report({ doc: op.doc, node: idNode }, `Operation "${label}" operationId "${id}" is not ${style}.`);
    }
  }
}

function checkComponentNames(ctx: RuleContext): void {
  for (const doc of ctx.documents) {
    const style = optionsForDoc(ctx, doc).componentName;
    if (!style) continue;

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

function checkParameterNames(ctx: RuleContext): void {
  for (const param of collectParameterObjects(ctx.graph, ctx.entryDoc, ctx.documents, ctx.version)) {
    const style = optionsForDoc(ctx, param.doc).parameterName;
    if (!style) continue;

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

function checkPropertyNames(ctx: RuleContext): void {
  const seen = new Set<Node>();
  for (const site of iterateSchemas(ctx.graph, ctx.entryDoc, ctx.documents, ctx.version)) {
    const style = optionsForDoc(ctx, site.doc).propertyName;
    if (!style) continue;

    // `patternProperties` (3.1) is deliberately not traversed: its keys are regexes, not property
    // names.
    walkSchemaTree(
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
      {},
      seen,
    );
  }
}

export const namingConvention: Rule = {
  name: "style/naming-convention",
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
    // Each check resolves its own per-file options (via `ctx.optionsFor`) since `lint.overrides`
    // can change which casing style applies (or whether the rule applies at all) per matched file.
    checkOperationIds(ctx);
    checkComponentNames(ctx);
    checkParameterNames(ctx);
    checkPropertyNames(ctx);
  },
};
