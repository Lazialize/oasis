import { isMap, isNode, isScalar, isSeq } from "yaml";
import type { Node } from "yaml";
import { COMPONENT_SECTIONS } from "@oasis/core";
import type { OasisDocument } from "@oasis/core";
import { iterateOperations, iteratePathItems } from "../openapi-walk.ts";
import { childAt, isRefObject, keyToString } from "../util.ts";
import type { Rule, RuleContext } from "../types.ts";

const STATUS_CODE = /^(default|[1-5](\d{2}|XX))$/;
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
    if (paths && !isMap(paths)) {
      reportWrongType(ctx, doc, paths, "paths", "an object");
    }

    const webhooks = childAt(root, "webhooks");
    if (webhooks && !isMap(webhooks)) {
      reportWrongType(ctx, doc, webhooks, "webhooks", "an object");
    }

    for (const pathItem of iteratePathItems(ctx.graph, ctx.entryDoc, ctx.version)) {
      const label = pathItem.origin === "webhooks" ? pathItem.template : `paths.${pathItem.template}`;
      if (!isMap(pathItem.node)) {
        reportWrongType(ctx, pathItem.doc, pathItem.node, label, "an object");
        continue;
      }
      const parameters = childAt(pathItem.node, "parameters");
      if (parameters && !isSeq(parameters)) {
        reportWrongType(ctx, pathItem.doc, parameters, `${label}.parameters`, "an array");
      }
    }

    for (const op of iterateOperations(ctx.graph, ctx.entryDoc, ctx.version)) {
      const pathLabel = op.pathItem.origin === "webhooks" ? op.pathItem.template : `paths.${op.pathItem.template}`;
      const fieldPath = `${pathLabel}.${op.method}`;
      if (!isMap(op.node)) {
        reportWrongType(ctx, op.doc, op.node, fieldPath, "an object");
        continue;
      }
      checkOperation(ctx, op.doc, op.node, fieldPath);
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
    // Operation.responses is REQUIRED in 3.0 but optional since 3.1 (webhook/async-style
    // operations may legitimately have none). Only 3.0 documents get the structural error;
    // the style-level nudge for 3.1 lives in operation/success-response.
    if (ctx.version === "3.0") {
      ctx.report({ doc, node: op }, `"${fieldPath}" is missing required field "responses".`);
    }
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
