import { isMap, isNode, isScalar } from "yaml";
import type { Node } from "yaml";
import type { OasisDocument } from "@oasis/core";
import { childAt, keyToString, resolveMaybeRef } from "../util.ts";
import type { Rule, RuleContext } from "../types.ts";

const SCHEME_TYPES_30 = new Set(["apiKey", "http", "oauth2", "openIdConnect"]);
const SCHEME_TYPES_31 = new Set([...SCHEME_TYPES_30, "mutualTLS"]);
const API_KEY_LOCATIONS = new Set(["query", "header", "cookie"]);

const FLOW_TYPES = ["implicit", "password", "clientCredentials", "authorizationCode"] as const;
type FlowType = (typeof FLOW_TYPES)[number];

/** Required fields of each OAuth Flow Object, beyond the always-required "scopes". */
const FLOW_URL_FIELDS: Record<FlowType, string[]> = {
  implicit: ["authorizationUrl"],
  password: ["tokenUrl"],
  clientCredentials: ["tokenUrl"],
  authorizationCode: ["authorizationUrl", "tokenUrl"],
};

function isNonEmptyString(node: Node | undefined): boolean {
  return !!node && isScalar(node) && typeof node.value === "string" && node.value !== "";
}

function checkFlow(ctx: RuleContext, doc: OasisDocument, flowType: FlowType, flowNode: Node, label: string): void {
  if (!isMap(flowNode)) {
    ctx.report({ doc, node: flowNode }, `${label} flow "${flowType}" must be an object.`);
    return;
  }

  for (const field of FLOW_URL_FIELDS[flowType]) {
    const fieldNode = childAt(flowNode, field);
    if (!isNonEmptyString(fieldNode)) {
      ctx.report({ doc, node: fieldNode ?? flowNode }, `${label} flow "${flowType}" is missing required field "${field}" (string).`);
    }
  }

  const scopesNode = childAt(flowNode, "scopes");
  if (!scopesNode || !isMap(scopesNode)) {
    ctx.report({ doc, node: scopesNode ?? flowNode }, `${label} flow "${flowType}" is missing required field "scopes" (object).`);
  }
}

function checkSecurityScheme(ctx: RuleContext, doc: OasisDocument, node: Node, label: string): void {
  if (!isMap(node)) {
    ctx.report({ doc, node }, `${label} must be an object.`);
    return;
  }

  const validTypes = ctx.version === "3.1" ? SCHEME_TYPES_31 : SCHEME_TYPES_30;
  const typeNode = childAt(node, "type");
  if (!typeNode || !isScalar(typeNode) || typeof typeNode.value !== "string") {
    ctx.report({ doc, node }, `${label} is missing required field "type".`);
    return;
  }

  const type = typeNode.value;
  if (!validTypes.has(type)) {
    ctx.report(
      { doc, node: typeNode },
      `${label} has unrecognized "type" value "${type}"; expected one of: ${[...validTypes].join(", ")}.`,
    );
    return;
  }

  switch (type) {
    case "apiKey": {
      if (!isNonEmptyString(childAt(node, "name"))) {
        ctx.report({ doc, node }, `${label} (apiKey) is missing required field "name" (string).`);
      }
      const inNode = childAt(node, "in");
      if (!inNode || !isScalar(inNode) || typeof inNode.value !== "string" || !API_KEY_LOCATIONS.has(inNode.value)) {
        ctx.report({ doc, node: inNode ?? node }, `${label} (apiKey) must have "in" set to one of: query, header, cookie.`);
      }
      break;
    }
    case "http": {
      if (!isNonEmptyString(childAt(node, "scheme"))) {
        ctx.report({ doc, node }, `${label} (http) is missing required field "scheme" (string).`);
      }
      break;
    }
    case "oauth2": {
      const flowsNode = childAt(node, "flows");
      if (!flowsNode || !isMap(flowsNode)) {
        ctx.report({ doc, node }, `${label} (oauth2) is missing required field "flows" (object).`);
        break;
      }
      const presentFlows = FLOW_TYPES.filter((flowType) => !!childAt(flowsNode, flowType));
      if (presentFlows.length === 0) {
        ctx.report(
          { doc, node: flowsNode },
          `${label} (oauth2) "flows" must define at least one of: ${FLOW_TYPES.join(", ")}.`,
        );
      }
      for (const flowType of presentFlows) {
        const flowNode = childAt(flowsNode, flowType);
        if (flowNode) checkFlow(ctx, doc, flowType, flowNode, label);
      }
      break;
    }
    case "openIdConnect": {
      if (!isNonEmptyString(childAt(node, "openIdConnectUrl"))) {
        ctx.report({ doc, node }, `${label} (openIdConnect) is missing required field "openIdConnectUrl" (string).`);
      }
      break;
    }
    case "mutualTLS":
      // 3.1 only (already gated by validTypes above); no extra required fields beyond "type".
      break;
  }
}

export const structureSecuritySchemes: Rule = {
  name: "structure/security-schemes",
  description:
    'Checks Security Scheme Objects under "components/securitySchemes": a recognized "type" (apiKey/http/oauth2/openIdConnect, plus 3.1 "mutualTLS"), and each type\'s required fields.',
  defaultSeverity: "error",
  check(ctx) {
    const seen = new Set<string>();
    for (const doc of ctx.documents) {
      const root = doc.yamlDoc.contents;
      if (!root || !isMap(root)) continue;
      const componentsNode = childAt(root, "components");
      if (!componentsNode || !isMap(componentsNode)) continue;
      const schemesNode = childAt(componentsNode, "securitySchemes");
      if (!schemesNode || !isMap(schemesNode)) continue;

      for (const pair of schemesNode.items) {
        const name = keyToString(pair.key);
        if (!isNode(pair.value)) continue;
        const resolved = resolveMaybeRef(ctx.graph, doc, pair.value, `/components/securitySchemes/${name}`);
        const key = `${resolved.doc.filePath}::${resolved.pointer}`;
        if (seen.has(key)) continue;
        seen.add(key);
        checkSecurityScheme(ctx, resolved.doc, resolved.node, `Security scheme "${name}"`);
      }
    }
  },
};
