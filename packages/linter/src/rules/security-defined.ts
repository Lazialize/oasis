import { isMap, isNode, isScalar, isSeq } from "yaml";
import type { Node } from "yaml";
import type { OasisDocument } from "@oasis/core";
import { iterateOperations } from "../openapi-walk.ts";
import { childAt, keyToString, resolveMaybeRef } from "../util.ts";
import type { Rule, RuleContext } from "../types.ts";

interface SchemeInfo {
  /** The scheme's `type` value (apiKey, http, oauth2, openIdConnect, ...), if present. */
  type: string | undefined;
  /** For oauth2 schemes: the union of scope names declared across all `flows.*.scopes` maps. */
  oauth2Scopes: Set<string> | undefined;
}

/** Collect every scheme declared under any document's `components/securitySchemes`. */
function collectDefinedSchemes(ctx: RuleContext): Map<string, SchemeInfo> {
  const defined = new Map<string, SchemeInfo>();
  for (const doc of ctx.documents) {
    const root = doc.yamlDoc.contents;
    if (!root || !isMap(root)) continue;
    const componentsNode = childAt(root, "components");
    if (!componentsNode || !isMap(componentsNode)) continue;
    const schemesNode = childAt(componentsNode, "securitySchemes");
    if (!schemesNode || !isMap(schemesNode)) continue;
    for (const pair of schemesNode.items) {
      const name = keyToString(pair.key);
      if (defined.has(name)) continue;
      defined.set(name, isNode(pair.value) ? readSchemeInfo(ctx, doc, pair.value) : { type: undefined, oauth2Scopes: undefined });
    }
  }
  return defined;
}

function readSchemeInfo(ctx: RuleContext, doc: OasisDocument, node: Node): SchemeInfo {
  const resolved = resolveMaybeRef(ctx.graph, doc, node, "");
  if (!isMap(resolved.node)) return { type: undefined, oauth2Scopes: undefined };

  const typeNode = childAt(resolved.node, "type");
  const type = isScalar(typeNode) && typeof typeNode.value === "string" ? typeNode.value : undefined;
  if (type !== "oauth2") return { type, oauth2Scopes: undefined };

  const oauth2Scopes = new Set<string>();
  const flowsNode = childAt(resolved.node, "flows");
  if (isMap(flowsNode)) {
    for (const flowPair of flowsNode.items) {
      if (!isNode(flowPair.value) || !isMap(flowPair.value)) continue;
      const scopesNode = childAt(flowPair.value, "scopes");
      if (!isMap(scopesNode)) continue;
      for (const scopePair of scopesNode.items) oauth2Scopes.add(keyToString(scopePair.key));
    }
  }
  return { type, oauth2Scopes };
}

/**
 * Check a `security` requirement array node: every scheme name must be defined, oauth2 scopes
 * must exist in the scheme's flows, and non-oauth2/openIdConnect schemes must not list scopes.
 */
function checkSecurityNode(
  ctx: RuleContext,
  doc: OasisDocument,
  securityNode: Node,
  defined: Map<string, SchemeInfo>,
  label: string,
): void {
  if (!isSeq(securityNode)) return;
  for (const requirement of securityNode.items) {
    // `- {}` is a valid requirement meaning "security is optional"; an empty map has no pairs.
    if (!isNode(requirement) || !isMap(requirement)) continue;
    for (const pair of requirement.items) {
      const name = keyToString(pair.key);
      const info = defined.get(name);
      if (!info) {
        const node = isNode(pair.key) ? pair.key : requirement;
        ctx.report(
          { doc, node },
          `${label} references security scheme "${name}", which is not defined in "components/securitySchemes".`,
        );
        continue;
      }

      if (!isSeq(pair.value)) continue;
      const scopeItems = pair.value.items;

      if (info.type === "oauth2") {
        // Scope names requested by a requirement must exist in the scheme's declared flows.
        for (const item of scopeItems) {
          if (!isScalar(item)) continue;
          const scope = String(item.value);
          if (info.oauth2Scopes?.has(scope)) continue;
          ctx.report(
            { doc, node: item },
            `${label} requests scope "${scope}", which is not declared by any flow of security scheme "${name}".`,
          );
        }
      } else if (info.type !== "openIdConnect" && info.type !== undefined && scopeItems.length > 0) {
        // Only oauth2 and openIdConnect requirements may list scopes; openIdConnect scope names
        // live in the discovery document and cannot be validated statically, so any are accepted.
        ctx.report(
          { doc, node: pair.value },
          `${label} lists scopes for security scheme "${name}" of type "${info.type}"; only "oauth2" and "openIdConnect" schemes accept scopes.`,
        );
      }
    }
  }
}

export const securityDefined: Rule = {
  name: "security/defined",
  description:
    'Requires every scheme name referenced in a "security" requirement to exist in "components/securitySchemes", every requested oauth2 scope to be declared by one of the scheme\'s flows, and scopes to be listed only for "oauth2"/"openIdConnect" schemes.',
  defaultSeverity: "error",
  check(ctx) {
    const defined = collectDefinedSchemes(ctx);

    const root = ctx.entryDoc.yamlDoc.contents;
    if (root && isMap(root)) {
      const rootSecurity = childAt(root, "security");
      if (rootSecurity) checkSecurityNode(ctx, ctx.entryDoc, rootSecurity, defined, "The document's root");
    }

    for (const op of iterateOperations(ctx.graph, ctx.entryDoc, ctx.version)) {
      const opSecurity = childAt(op.node, "security");
      if (!opSecurity) continue;
      const label = `Operation "${op.method.toUpperCase()} ${op.pathItem.template}"`;
      checkSecurityNode(ctx, op.doc, opSecurity, defined, label);
    }
  },
};
