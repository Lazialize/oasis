import { isMap, isNode, isSeq } from "yaml";
import type { Node } from "yaml";
import type { OasisDocument } from "@oasis/core";
import { iterateOperations } from "../openapi-walk.ts";
import { childAt, keyToString } from "../util.ts";
import type { Rule, RuleContext } from "../types.ts";

/** Collect every scheme name declared under any document's `components/securitySchemes`. */
function collectDefinedSchemes(ctx: RuleContext): Set<string> {
  const defined = new Set<string>();
  for (const doc of ctx.documents) {
    const root = doc.yamlDoc.contents;
    if (!root || !isMap(root)) continue;
    const componentsNode = childAt(root, "components");
    if (!componentsNode || !isMap(componentsNode)) continue;
    const schemesNode = childAt(componentsNode, "securitySchemes");
    if (!schemesNode || !isMap(schemesNode)) continue;
    for (const pair of schemesNode.items) defined.add(keyToString(pair.key));
  }
  return defined;
}

/** Check a `security` requirement array node, reporting any scheme name not in `defined`. */
function checkSecurityNode(
  ctx: RuleContext,
  doc: OasisDocument,
  securityNode: Node,
  defined: Set<string>,
  label: string,
): void {
  if (!isSeq(securityNode)) return;
  for (const requirement of securityNode.items) {
    if (!isNode(requirement) || !isMap(requirement)) continue;
    for (const pair of requirement.items) {
      const name = keyToString(pair.key);
      if (defined.has(name)) continue;
      const node = isNode(pair.key) ? pair.key : requirement;
      ctx.report(
        { doc, node },
        `${label} references security scheme "${name}", which is not defined in "components/securitySchemes".`,
      );
    }
  }
}

export const securityDefined: Rule = {
  name: "security-defined",
  description: 'Requires every scheme name referenced in a "security" requirement to exist in "components/securitySchemes".',
  defaultSeverity: "error",
  check(ctx) {
    const defined = collectDefinedSchemes(ctx);

    const root = ctx.entryDoc.yamlDoc.contents;
    if (root && isMap(root)) {
      const rootSecurity = childAt(root, "security");
      if (rootSecurity) checkSecurityNode(ctx, ctx.entryDoc, rootSecurity, defined, "The document's root");
    }

    for (const op of iterateOperations(ctx.graph, ctx.entryDoc)) {
      const opSecurity = childAt(op.node, "security");
      if (!opSecurity) continue;
      const label = `Operation "${op.method.toUpperCase()} ${op.pathItem.template}"`;
      checkSecurityNode(ctx, op.doc, opSecurity, defined, label);
    }
  },
};
