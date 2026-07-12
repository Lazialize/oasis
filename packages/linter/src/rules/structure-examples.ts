import { isMap, isNode, isScalar, isSeq } from "yaml";
import type { Node } from "yaml";
import type { OasisDocument } from "@oasis/core";
import { iterateMediaTypes, iterateOperations, iteratePathItems } from "../openapi-walk.ts";
import { childAt, isRefObject, keyToString, resolveMaybeRef } from "../util.ts";
import type { Rule, RuleContext } from "../types.ts";

const ALLOWED_KEYS = new Set(["summary", "description", "value", "externalValue"]);

function checkExampleObject(ctx: RuleContext, doc: OasisDocument, node: Node, label: string): void {
  if (!isMap(node) || isRefObject(node)) return;

  for (const pair of node.items) {
    const key = keyToString(pair.key);
    if (key.startsWith("x-")) continue;
    if (!ALLOWED_KEYS.has(key) && isNode(pair.key)) {
      ctx.report(
        { doc, node: pair.key },
        `${label} has unknown key "${key}"; expected one of: summary, description, value, externalValue.`,
      );
    }
  }

  const valueNode = childAt(node, "value");
  const externalValueNode = childAt(node, "externalValue");
  if (valueNode && externalValueNode) {
    ctx.report({ doc, node: externalValueNode }, `${label} must not set both "value" and "externalValue".`);
  }
  if (externalValueNode && (!isScalar(externalValueNode) || typeof externalValueNode.value !== "string")) {
    ctx.report({ doc, node: externalValueNode }, `${label} "externalValue" must be a string.`);
  }
}

/** Checks a Map[string, Example Object | Reference Object], resolving each entry's `$ref` first. */
function checkExamplesMap(ctx: RuleContext, doc: OasisDocument, mapNode: Node, pointer: string, labelPrefix: string): void {
  if (!isMap(mapNode)) return;
  for (const pair of mapNode.items) {
    const name = keyToString(pair.key);
    if (!isNode(pair.value)) continue;
    const resolved = resolveMaybeRef(ctx.graph, doc, pair.value, `${pointer}/${name}`);
    checkExampleObject(ctx, resolved.doc, resolved.node, `${labelPrefix} example "${name}"`);
  }
}

/** Every Parameter Object reachable from path items, operations, and `components/parameters`. */
function collectParameterObjects(ctx: RuleContext): { doc: OasisDocument; node: Node }[] {
  const seen = new Set<string>();
  const results: { doc: OasisDocument; node: Node }[] = [];

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

export const structureExamples: Rule = {
  name: "structure/examples",
  description:
    'Checks Example Objects in "components/examples" and inline "examples" maps (Media Type and Parameter Objects): "value"/"externalValue" are mutually exclusive, only known keys are used, and "externalValue" is a string.',
  defaultSeverity: "error",
  check(ctx) {
    for (const doc of ctx.documents) {
      const root = doc.yamlDoc.contents;
      if (!root || !isMap(root)) continue;
      const componentsNode = childAt(root, "components");
      if (!componentsNode || !isMap(componentsNode)) continue;
      const examplesNode = childAt(componentsNode, "examples");
      if (examplesNode) checkExamplesMap(ctx, doc, examplesNode, "/components/examples", '"components/examples"');
    }

    for (const site of iterateMediaTypes(ctx.graph, ctx.entryDoc, ctx.documents, ctx.version)) {
      const examplesNode = childAt(site.node, "examples");
      if (examplesNode) checkExamplesMap(ctx, site.doc, examplesNode, `${site.pointer}/examples`, `"${site.pointer}"`);
    }

    for (const param of collectParameterObjects(ctx)) {
      const examplesNode = childAt(param.node, "examples");
      if (!examplesNode) continue;
      const nameNode = childAt(param.node, "name");
      const paramName = isScalar(nameNode) && typeof nameNode.value === "string" ? nameNode.value : "?";
      checkExamplesMap(ctx, param.doc, examplesNode, "", `Parameter "${paramName}"`);
    }
  },
};
