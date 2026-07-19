import { isMap, isNode, isScalar, isSeq } from "yaml";
import type { Node } from "yaml";
import type { OasisDocument } from "@oasis/core";
import { iterateOperations, iteratePathItems } from "../openapi-walk.ts";
import { childAt, keyToString } from "../util.ts";
import type { Rule, RuleContext } from "../types.ts";

/** Matches `{var}` templates in a Server Object's `url` (does not handle nested braces). */
const VAR_PATTERN = /\{([^{}]+)\}/g;

function extractVars(url: string): string[] {
  const names: string[] = [];
  for (const match of url.matchAll(VAR_PATTERN)) {
    if (match[1] !== undefined) names.push(match[1]);
  }
  return names;
}

function checkServerVariable(ctx: RuleContext, doc: OasisDocument, name: string, node: Node, label: string): void {
  if (!isMap(node)) {
    ctx.report({ doc, node }, `${label} variable "${name}" must be an object.`);
    return;
  }

  const defaultNode = childAt(node, "default");
  if (!defaultNode || !isScalar(defaultNode) || typeof defaultNode.value !== "string") {
    ctx.report({ doc, node }, `${label} variable "${name}" is missing required field "default" (string).`);
  }

  const enumNode = childAt(node, "enum");
  if (!enumNode) return;

  if (!isSeq(enumNode) || enumNode.items.length === 0) {
    ctx.report({ doc, node: enumNode }, `${label} variable "${name}" "enum" must be a non-empty array of strings.`);
    return;
  }

  const values: string[] = [];
  let allStrings = true;
  for (const item of enumNode.items) {
    if (isNode(item) && isScalar(item) && typeof item.value === "string") {
      values.push(item.value);
    } else {
      allStrings = false;
    }
  }

  if (!allStrings) {
    ctx.report({ doc, node: enumNode }, `${label} variable "${name}" "enum" must contain only strings.`);
  } else if (defaultNode && isScalar(defaultNode) && typeof defaultNode.value === "string" && !values.includes(defaultNode.value)) {
    ctx.report({ doc, node: defaultNode }, `${label} variable "${name}" "default" must be one of the values listed in "enum".`);
  }
}

function checkServerObject(ctx: RuleContext, doc: OasisDocument, node: Node, label: string): void {
  if (!isMap(node)) {
    ctx.report({ doc, node }, `${label} must be an object.`);
    return;
  }

  const urlNode = childAt(node, "url");
  let urlValue: string | undefined;
  if (!urlNode) {
    ctx.report({ doc, node }, `${label} is missing required field "url" (string).`);
  } else if (!isScalar(urlNode) || typeof urlNode.value !== "string") {
    ctx.report({ doc, node: urlNode }, `${label} "url" must be a string.`);
  } else {
    urlValue = urlNode.value;
  }

  const nameNode = childAt(node, "name");
  if (nameNode) {
    if (ctx.version !== "3.2") {
      ctx.report({ doc, node: nameNode }, `${label} field "name" is only valid in OpenAPI 3.2.`);
    } else if (!isScalar(nameNode) || typeof nameNode.value !== "string") {
      ctx.report({ doc, node: nameNode }, `${label} "name" must be a string.`);
    }
  }

  const variablesNode = childAt(node, "variables");
  const declared = new Map<string, Node>();
  if (variablesNode) {
    if (isMap(variablesNode)) {
      for (const pair of variablesNode.items) {
        if (isNode(pair.value)) declared.set(keyToString(pair.key), pair.value);
      }
    } else {
      ctx.report({ doc, node: variablesNode }, `${label} "variables" must be an object.`);
    }
  }

  // Shape validation for each declared Server Variable Object runs regardless of whether "url"
  // itself is present/valid, so a variable missing "default" is still reported.
  for (const [name, varNode] of declared) {
    checkServerVariable(ctx, doc, name, varNode, label);
  }

  // Cross-checks between "url" placeholders and declared "variables" only make sense once "url"
  // resolved to an actual string above.
  if (urlValue === undefined) return;

  const urlVars = new Set(extractVars(urlValue));
  for (const varName of urlVars) {
    if (!declared.has(varName)) {
      ctx.report(
        { doc, node: variablesNode ?? urlNode! },
        `${label} url references "{${varName}}" but "variables" does not define it.`,
      );
    }
  }

  for (const [name, varNode] of declared) {
    if (!urlVars.has(name)) {
      ctx.report(
        { doc, node: varNode },
        `${label} declares variable "${name}" which is not referenced in "url".`,
        { severity: "warn" },
      );
    }
  }
}

function checkServersArray(ctx: RuleContext, doc: OasisDocument, serversNode: Node | undefined, label: string): void {
  if (!serversNode || !isSeq(serversNode)) return;
  serversNode.items.forEach((item, i) => {
    if (isNode(item)) checkServerObject(ctx, doc, item, `${label}.servers[${i}]`);
  });
}

export const structureServerVariables: Rule = {
  name: "structure/server-variables",
  description:
    'Checks Server Object "variables": every "{var}" in "url" has a matching entry with a "default" (string); "enum" (if present) is a non-empty string array containing "default". Warns (does not error) about declared variables unused by "url".',
  defaultSeverity: "error",
  check(ctx) {
    const root = ctx.entryDoc.yamlDoc.contents;
    if (root && isMap(root)) {
      checkServersArray(ctx, ctx.entryDoc, childAt(root, "servers"), "Root");
    }

    for (const pathItem of iteratePathItems(ctx.graph, ctx.entryDoc, ctx.version)) {
      if (!isMap(pathItem.node)) continue;
      checkServersArray(ctx, pathItem.doc, childAt(pathItem.node, "servers"), `Path item "${pathItem.template}"`);
    }

    for (const op of iterateOperations(ctx.graph, ctx.entryDoc, ctx.version)) {
      if (!isMap(op.node)) continue;
      checkServersArray(
        ctx,
        op.doc,
        childAt(op.node, "servers"),
        `Operation "${op.method.toUpperCase()} ${op.pathItem.template}"`,
      );
    }
  },
};
