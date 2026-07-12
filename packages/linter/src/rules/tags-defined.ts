import { isMap, isScalar, isSeq } from "yaml";
import type { Node } from "yaml";
import { iterateOperations } from "../openapi-walk.ts";
import { childAt } from "../util.ts";
import type { Rule } from "../types.ts";

/** Collect the tag names declared in the root `tags` list. */
function collectDeclaredTags(root: Node | undefined): Set<string> {
  const declared = new Set<string>();
  if (!root || !isSeq(root)) return declared;
  for (const item of root.items) {
    if (!isMap(item)) continue;
    const nameNode = childAt(item, "name");
    if (isScalar(nameNode) && typeof nameNode.value === "string") declared.add(nameNode.value);
  }
  return declared;
}

export const tagsDefined: Rule = {
  name: "tags/defined",
  description: 'Requires every tag used by an operation to be declared in the root "tags" list.',
  defaultSeverity: "off",
  check(ctx) {
    const root = ctx.entryDoc.yamlDoc.contents;
    if (!root || !isMap(root)) return;
    const declared = collectDeclaredTags(childAt(root, "tags"));

    for (const op of iterateOperations(ctx.graph, ctx.entryDoc, ctx.version)) {
      const tagsNode = childAt(op.node, "tags");
      if (!tagsNode || !isSeq(tagsNode)) continue;
      const label = `${op.method.toUpperCase()} ${op.pathItem.template}`;

      for (const item of tagsNode.items) {
        if (!isScalar(item) || typeof item.value !== "string" || item.value === "") continue;
        if (declared.has(item.value)) continue;
        ctx.report(
          { doc: op.doc, node: item },
          `Operation "${label}" uses tag "${item.value}", which is not declared in the root "tags" list.`,
        );
      }
    }
  },
};
