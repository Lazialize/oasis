import { isMap, isNode, isScalar, isSeq } from "yaml";
import type { Node } from "yaml";
import { COMPONENT_SECTIONS } from "@oasis/core";
import type { OasisDocument } from "@oasis/core";
import { HTTP_METHODS } from "../openapi-walk.ts";
import { childAt, isRefObject, keyToString } from "../util.ts";
import type { Rule, RuleContext } from "../types.ts";

const STATUS_CODE = /^(default|[1-5](\d{2}|XX))$/i;
const PARAMETER_LOCATIONS = new Set(["query", "header", "path", "cookie"]);

function reportWrongType(ctx: RuleContext, doc: OasisDocument, node: Node, fieldPath: string, expected: string): void {
  ctx.report({ doc, node }, `"${fieldPath}" must be ${expected}.`);
}

function checkObjectField(
  ctx: RuleContext,
  doc: OasisDocument,
  parent: Node,
  field: string,
  expected: string,
  guard: (node: Node) => boolean,
): void {
  const node = childAt(parent, field);
  if (node && !guard(node)) {
    reportWrongType(ctx, doc, node, field, expected);
  }
}

export const structureFieldTypes: Rule = {
  name: "structure/field-types",
  description: "Checks that common top-level and operation-level fields have the correct JSON type.",
  defaultSeverity: "error",
  check(ctx) {
    const doc = ctx.entryDoc;
    const root = doc.yamlDoc.contents;
    if (!root || !isMap(root)) return;

    checkObjectField(ctx, doc, root, "tags", "an array", isSeq);
    checkObjectField(ctx, doc, root, "servers", "an array", isSeq);
    checkObjectField(ctx, doc, root, "security", "an array", isSeq);

    const paths = childAt(root, "paths");
    if (paths) {
      if (!isMap(paths)) {
        reportWrongType(ctx, doc, paths, "paths", "an object");
      } else {
        for (const pair of paths.items) {
          const template = keyToString(pair.key);
          if (!isNode(pair.value)) continue;
          const pathItem = pair.value;
          if (!isMap(pathItem)) {
            reportWrongType(ctx, doc, pathItem, `paths.${template}`, "an object");
            continue;
          }
          if (!isRefObject(pathItem)) checkPathItem(ctx, doc, pathItem, template);
        }
      }
    }

    const components = childAt(root, "components");
    if (components) {
      if (!isMap(components)) {
        reportWrongType(ctx, doc, components, "components", "an object");
      } else {
        for (const category of COMPONENT_SECTIONS) {
          const categoryNode = childAt(components, category);
          if (categoryNode && !isMap(categoryNode)) {
            reportWrongType(ctx, doc, categoryNode, `components.${category}`, "an object");
          }
        }
      }
    }
  },
};

function checkPathItem(ctx: RuleContext, doc: OasisDocument, pathItem: Node, template: string): void {
  if (!isMap(pathItem)) return;

  const parameters = childAt(pathItem, "parameters");
  if (parameters && !isSeq(parameters)) {
    reportWrongType(ctx, doc, parameters, `paths.${template}.parameters`, "an array");
  }

  for (const method of HTTP_METHODS) {
    const opNode = childAt(pathItem, method);
    if (!opNode) continue;
    if (!isMap(opNode)) {
      reportWrongType(ctx, doc, opNode, `paths.${template}.${method}`, "an object");
      continue;
    }
    checkOperation(ctx, doc, opNode, `paths.${template}.${method}`);
  }
}

function checkOperation(ctx: RuleContext, doc: OasisDocument, op: Node, fieldPath: string): void {
  if (!isMap(op)) return;

  const opParams = childAt(op, "parameters");
  if (opParams && !isSeq(opParams)) {
    reportWrongType(ctx, doc, opParams, `${fieldPath}.parameters`, "an array");
  }

  const opTags = childAt(op, "tags");
  if (opTags && !isSeq(opTags)) {
    reportWrongType(ctx, doc, opTags, `${fieldPath}.tags`, "an array");
  }

  const responses = childAt(op, "responses");
  if (!responses) {
    ctx.report({ doc, node: op }, `"${fieldPath}" is missing required field "responses".`);
  } else if (!isMap(responses)) {
    reportWrongType(ctx, doc, responses, `${fieldPath}.responses`, "an object");
  } else {
    for (const pair of responses.items) {
      const status = keyToString(pair.key);
      if (!STATUS_CODE.test(status) && isNode(pair.key)) {
        ctx.report(
          { doc, node: pair.key },
          `"${fieldPath}.responses" key "${status}" is not a valid HTTP status code, status range ("2XX"), or "default".`,
        );
      }
    }
  }

  const requestBody = childAt(op, "requestBody");
  if (requestBody && !isMap(requestBody)) {
    reportWrongType(ctx, doc, requestBody, `${fieldPath}.requestBody`, "an object");
  }

  const parametersToCheck = isSeq(opParams) ? opParams.items : [];
  for (const item of parametersToCheck) {
    if (!isNode(item) || !isMap(item) || isRefObject(item)) continue;
    const paramNode = item;

    const nameNode = childAt(paramNode, "name");
    if (!nameNode || !isScalar(nameNode) || typeof nameNode.value !== "string") {
      ctx.report({ doc, node: paramNode }, `"${fieldPath}" parameter is missing required field "name" (string).`);
    }
    const inNode = childAt(paramNode, "in");
    if (!inNode || !isScalar(inNode) || typeof inNode.value !== "string" || !PARAMETER_LOCATIONS.has(inNode.value)) {
      ctx.report(
        { doc, node: inNode ?? paramNode },
        `"${fieldPath}" parameter must have "in" set to one of: query, header, path, cookie.`,
      );
    }
  }
}
