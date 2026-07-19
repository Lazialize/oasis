import { isMap, isNode, isScalar, isSeq } from "yaml";
import type { Node } from "yaml";
import { COMPONENT_SECTIONS } from "@oasis/core";
import type { OasisDocument } from "@oasis/core";
import { collectParameterObjects, iterateOperations, iteratePathItems } from "../openapi-walk.ts";
import { RESPONSE_STATUS_CODE_PATTERN, childAt, hasAnyResponseEntry, keyToString, resolveMaybeRef } from "../util.ts";
import type { Rule, RuleContext } from "../types.ts";

const PARAMETER_LOCATIONS = new Set(["query", "header", "path", "cookie"]);

/** Valid `style` values per parameter location (OpenAPI 3.0/3.1 Parameter Object, `style` field). */
const VALID_STYLES_BY_LOCATION: Record<string, Set<string>> = {
  path: new Set(["matrix", "label", "simple"]),
  query: new Set(["form", "spaceDelimited", "pipeDelimited", "deepObject"]),
  header: new Set(["simple"]),
  cookie: new Set(["form"]),
};

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
        const componentResponses = childAt(components, "responses");
        if (isMap(componentResponses)) {
          for (const pair of componentResponses.items) {
            if (!isNode(pair.value)) continue;
            const name = keyToString(pair.key);
            const resolved = resolveMaybeRef(ctx.graph, doc, pair.value, `/components/responses/${name}`);
            checkResponseObject(ctx, resolved.doc, resolved.node, `components.responses.${name}`);
          }
        }
      }
    }

    // Every Parameter Object reachable from components/parameters, Path Item parameters, Operation
    // parameters, and (same-document/cross-file) Reference Objects to any of those, deduplicated by
    // resolved location so a shared parameter is only checked once and diagnostics are attributed to
    // the document that actually owns the parameter node.
    for (const param of collectParameterObjects(ctx.graph, ctx.entryDoc, ctx.documents, ctx.version)) {
      checkParameterObject(ctx, param.doc, param.node, `"${param.pointer}"`);
    }
  },
};

function checkParameterObject(ctx: RuleContext, doc: OasisDocument, node: Node, label: string): void {
  if (!isMap(node)) {
    reportWrongType(ctx, doc, node, label.replace(/^"|"$/g, ""), "an object");
    return;
  }

  const nameNode = childAt(node, "name");
  if (!nameNode || !isScalar(nameNode) || typeof nameNode.value !== "string" || nameNode.value === "") {
    ctx.report({ doc, node }, `${label} is missing required field "name" (string).`);
  }

  const inNode = childAt(node, "in");
  let location: string | undefined;
  const validLocations = ctx.version === "3.2" ? new Set([...PARAMETER_LOCATIONS, "querystring"]) : PARAMETER_LOCATIONS;
  if (!inNode || !isScalar(inNode) || typeof inNode.value !== "string" || !validLocations.has(inNode.value)) {
    ctx.report({ doc, node: inNode ?? node }, `${label} must have "in" set to one of: ${[...validLocations].join(", ")}.`);
  } else {
    location = inNode.value;
  }

  if (location === "path") {
    const requiredNode = childAt(node, "required");
    const requiredIsTrue = !!requiredNode && isScalar(requiredNode) && requiredNode.value === true;
    if (!requiredIsTrue) {
      ctx.report({ doc, node: requiredNode ?? node }, `${label} has "in: path" and must set "required: true".`);
    }
  }

  const schemaNode = childAt(node, "schema");
  const contentNode = childAt(node, "content");
  if (schemaNode && contentNode) {
    ctx.report({ doc, node }, `${label} must not have both "schema" and "content"; they are mutually exclusive.`);
  } else if (contentNode && (!isMap(contentNode) || contentNode.items.length !== 1)) {
    ctx.report({ doc, node: contentNode }, `${label} "content" must be an object with exactly one entry.`);
  }
  if (location === "querystring") {
    if (!contentNode) {
      ctx.report({ doc, node }, `${label} has "in: querystring" and must define "content".`);
    }
    if (schemaNode) {
      ctx.report({ doc, node: schemaNode }, `${label} must not use "schema" with "in: querystring".`);
    }
  }

  const styleNode = childAt(node, "style");
  if (styleNode) {
    if (!isScalar(styleNode) || typeof styleNode.value !== "string") {
      ctx.report({ doc, node: styleNode }, `${label} "style" must be a string.`);
    } else if (location) {
      const validStyles = location === "cookie" && ctx.version === "3.2"
        ? new Set([...VALID_STYLES_BY_LOCATION.cookie!, "cookie"])
        : VALID_STYLES_BY_LOCATION[location];
      if (!validStyles) {
        ctx.report({ doc, node: styleNode }, `${label} must not use "style" with "in: ${location}".`);
      } else if (!validStyles.has(styleNode.value)) {
        ctx.report(
          { doc, node: styleNode },
          `${label} "style: ${styleNode.value}" is not valid for "in: ${location}" (expected one of: ${[...validStyles].join(", ")}).`,
        );
      }
    }
  }

  const explodeNode = childAt(node, "explode");
  if (explodeNode && (!isScalar(explodeNode) || typeof explodeNode.value !== "boolean")) {
    ctx.report({ doc, node: explodeNode }, `${label} "explode" must be a boolean.`);
  }

  for (const field of ["allowEmptyValue", "allowReserved"] as const) {
    const fieldNode = childAt(node, field);
    if (!fieldNode) continue;
    if (!isScalar(fieldNode) || typeof fieldNode.value !== "boolean") {
      ctx.report({ doc, node: fieldNode }, `${label} "${field}" must be a boolean.`);
    } else if (location && field === "allowEmptyValue" && location !== "query") {
      ctx.report({ doc, node: fieldNode }, `${label} "${field}" only applies to "in: query" parameters.`);
    } else if (location && field === "allowReserved" && ctx.version !== "3.2" && location !== "query") {
      ctx.report({ doc, node: fieldNode }, `${label} "allowReserved" only applies to "in: query" parameters before OpenAPI 3.2.`);
    } else if (location === "querystring" && field === "allowReserved") {
      ctx.report({ doc, node: fieldNode }, `${label} must not use "allowReserved" with "in: querystring".`);
    }
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
    // Operation.responses is REQUIRED in 3.0 but optional since 3.1 (webhook/async-style
    // operations may legitimately have none). Only 3.0 documents get the structural error;
    // the style-level nudge for 3.1 lives in operation/success-response.
    if (ctx.version === "3.0") {
      ctx.report({ doc, node: op }, `"${fieldPath}" is missing required field "responses".`);
    }
  } else if (!isMap(responses)) {
    reportWrongType(ctx, doc, responses, `${fieldPath}.responses`, "an object");
  } else {
    if (!hasAnyResponseEntry(responses)) {
      ctx.report(
        { doc, node: responses },
        `"${fieldPath}.responses" must contain at least one response code, "default", or an extension ("x-*") field.`,
      );
    }
    for (const pair of responses.items) {
      const status = keyToString(pair.key);
      if (!RESPONSE_STATUS_CODE_PATTERN.test(status) && !status.startsWith("x-") && isNode(pair.key)) {
        ctx.report(
          { doc, node: pair.key },
          `"${fieldPath}.responses" key "${status}" is not a valid HTTP status code, status range ("2XX"), "default", or an extension ("x-*").`,
        );
      }
      if (isNode(pair.value)) {
        const resolved = resolveMaybeRef(ctx.graph, doc, pair.value, `${fieldPath}.responses.${status}`);
        checkResponseObject(ctx, resolved.doc, resolved.node, `${fieldPath}.responses.${status}`);
      }
    }
  }

  const requestBody = childAt(op, "requestBody");
  if (requestBody && !isMap(requestBody)) {
    reportWrongType(ctx, doc, requestBody, `${fieldPath}.requestBody`, "an object");
  }
}

function checkResponseObject(ctx: RuleContext, doc: OasisDocument, node: Node, label: string): void {
  if (!isMap(node)) return;
  const description = childAt(node, "description");
  if (!description && ctx.version !== "3.2") {
    ctx.report({ doc, node }, `"${label}" is missing required field "description".`);
  } else if (description && (!isScalar(description) || typeof description.value !== "string")) {
    ctx.report({ doc, node: description }, `"${label}.description" must be a string.`);
  }
  const summary = childAt(node, "summary");
  if (summary) {
    if (ctx.version !== "3.2") {
      ctx.report({ doc, node: summary }, `"${label}.summary" is only valid in OpenAPI 3.2.`);
    } else if (!isScalar(summary) || typeof summary.value !== "string") {
      ctx.report({ doc, node: summary }, `"${label}.summary" must be a string.`);
    }
  }
}
