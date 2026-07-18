import { isMap, isNode, isScalar, isSeq } from "yaml";
import type { Node } from "yaml";
import { rangeFromOffsets } from "@oasis/core";
import type { OasisDocument, Range, WorkspaceGraph } from "@oasis/core";
import { iteratePathItems, type PathItemInfo } from "../openapi-walk.ts";
import { childAt, resolveMaybeRef } from "../util.ts";
import type { Rule } from "../types.ts";

interface DeclaredParam {
  name: string;
  node: Node;
  doc: OasisDocument;
  required: boolean;
}

function pathTemplateParams(template: string): string[] {
  const names: string[] = [];
  const re = /\{([^}]+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(template))) {
    const name = match[1];
    if (name) names.push(name);
  }
  return names;
}

/** Collect `in: path` parameters declared directly on a parameters array (resolving $ref entries). */
function collectPathParams(graph: WorkspaceGraph, doc: OasisDocument, parametersNode: Node | undefined): DeclaredParam[] {
  if (!parametersNode || !isSeq(parametersNode)) return [];
  const result: DeclaredParam[] = [];
  for (const item of parametersNode.items) {
    if (!isNode(item)) continue;
    const resolved = resolveMaybeRef(graph, doc, item, "");
    if (!isMap(resolved.node)) continue;

    const inNode = childAt(resolved.node, "in");
    if (!isScalar(inNode) || inNode.value !== "path") continue;

    const nameNode = childAt(resolved.node, "name");
    if (!isScalar(nameNode) || typeof nameNode.value !== "string") continue;

    const requiredNode = childAt(resolved.node, "required");
    const required = isScalar(requiredNode) && requiredNode.value === true;

    result.push({ name: nameNode.value, node: resolved.node, doc: resolved.doc, required });
  }
  return result;
}

/**
 * Locate the `{name}` placeholder within the path template's key node source text, so a missing-
 * parameter diagnostic can point at the exact placeholder rather than the whole key. Falls back to
 * `undefined` if the key node has no range or the placeholder text can't be found verbatim (e.g. an
 * unusual quoting/escaping); callers fall back to the whole key node in that case.
 */
function templatePlaceholderRange(doc: OasisDocument, keyNode: Node, name: string): Range | undefined {
  const range = keyNode.range;
  if (!range) return undefined;
  const raw = doc.text.slice(range[0], range[1]);
  const needle = `{${name}}`;
  const idx = raw.indexOf(needle);
  if (idx === -1) return undefined;
  const start = range[0] + idx;
  return rangeFromOffsets(doc.filePath, doc.lineCounter, start, start + needle.length);
}

function checkOperationOrPathItem(
  ctx: { report: (loc: { doc: OasisDocument; node: Node } | Range, message: string) => void },
  pathItem: PathItemInfo,
  templateParams: string[],
  declared: DeclaredParam[],
  label: string,
): void {
  const declaredNames = new Set(declared.map((p) => p.name));
  for (const name of templateParams) {
    if (!declaredNames.has(name)) {
      // The path template key belongs to the entry document that owns `paths`/`webhooks`, which may
      // differ from `pathItem.doc` (the possibly $ref-resolved path item body). Attribute the
      // diagnostic to the owning key — ideally its `{name}` placeholder span — so source location,
      // suppressions, and `lint.overrides` are all evaluated against the file that actually declares
      // the invalid template, not the resolved Path Item file.
      const location = pathItem.keyNode
        ? (templatePlaceholderRange(pathItem.keyDoc, pathItem.keyNode, name) ?? { doc: pathItem.keyDoc, node: pathItem.keyNode })
        : { doc: pathItem.doc, node: pathItem.node };
      ctx.report(location, `${label}: path template parameter "{${name}}" has no matching "in: path" parameter definition.`);
    }
  }

  const templateNames = new Set(templateParams);
  for (const param of declared) {
    if (!templateNames.has(param.name)) {
      ctx.report(
        { doc: param.doc, node: param.node },
        `${label}: parameter "${param.name}" is declared "in: path" but does not appear in the path template "${pathItem.template}".`,
      );
      continue;
    }
    if (!param.required) {
      ctx.report(
        { doc: param.doc, node: param.node },
        `${label}: path parameter "${param.name}" must be declared "required: true".`,
      );
    }
  }
}

export const pathParamsDefined: Rule = {
  name: "paths/params-defined",
  description: 'Requires {param} path template placeholders and "in: path" parameters to agree, and path parameters to be required.',
  defaultSeverity: "error",
  check(ctx) {
    for (const pathItem of iteratePathItems(ctx.graph, ctx.entryDoc)) {
      if (!isMap(pathItem.node)) continue;
      const templateParams = pathTemplateParams(pathItem.template);

      const pathItemParams = collectPathParams(ctx.graph, pathItem.doc, childAt(pathItem.node, "parameters"));

      const methods = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;
      let hasOperation = false;
      for (const method of methods) {
        const opNode = childAt(pathItem.node, method);
        if (!opNode) continue;
        hasOperation = true;
        const resolvedOp = resolveMaybeRef(ctx.graph, pathItem.doc, opNode, `${pathItem.pointer}/${method}`);
        if (!isMap(resolvedOp.node)) continue;

        const opParams = collectPathParams(ctx.graph, resolvedOp.doc, childAt(resolvedOp.node, "parameters"));
        const merged = mergeParams(pathItemParams, opParams);
        checkOperationOrPathItem(ctx, pathItem, templateParams, merged, `${method.toUpperCase()} ${pathItem.template}`);
      }

      if (!hasOperation) {
        checkOperationOrPathItem(ctx, pathItem, templateParams, pathItemParams, pathItem.template);
      }
    }
  },
};

/** Operation-level parameters with the same name override path-item-level ones (per OpenAPI semantics). */
function mergeParams(pathItemParams: DeclaredParam[], opParams: DeclaredParam[]): DeclaredParam[] {
  const byName = new Map<string, DeclaredParam>();
  for (const p of pathItemParams) byName.set(p.name, p);
  for (const p of opParams) byName.set(p.name, p);
  return [...byName.values()];
}
