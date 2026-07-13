import { isMap, isScalar, isSeq } from "yaml";
import { iterateOperations } from "../openapi-walk.ts";
import { childAt } from "../util.ts";
import type { Rule, RuleContext } from "../types.ts";

/** Collect every tag name used by an operation's `tags` list. */
function collectUsedTags(ctx: RuleContext): Set<string> {
  const used = new Set<string>();
  for (const op of iterateOperations(ctx.graph, ctx.entryDoc, ctx.version)) {
    const tagsNode = childAt(op.node, "tags");
    if (!tagsNode || !isSeq(tagsNode)) continue;
    for (const item of tagsNode.items) {
      if (isScalar(item) && typeof item.value === "string" && item.value !== "") used.add(item.value);
    }
  }
  return used;
}

export const noUnusedTags: Rule = {
  name: "tags/no-unused",
  description: 'Requires every tag declared in the root "tags" list to be used by at least one operation.',
  defaultSeverity: "warn",
  check(ctx) {
    const root = ctx.entryDoc.yamlDoc.contents;
    if (!root || !isMap(root)) return;
    const tagsNode = childAt(root, "tags");
    if (!tagsNode || !isSeq(tagsNode)) return;

    const used = collectUsedTags(ctx);

    for (const item of tagsNode.items) {
      if (!isMap(item)) continue;
      const nameNode = childAt(item, "name");
      if (!isScalar(nameNode) || typeof nameNode.value !== "string" || nameNode.value === "") continue;
      if (used.has(nameNode.value)) continue;
      ctx.report({ doc: ctx.entryDoc, node: item }, `Tag "${nameNode.value}" is declared but not used by any operation.`);
    }
  },
};
