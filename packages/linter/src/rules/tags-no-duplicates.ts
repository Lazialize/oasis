import { isMap, isScalar, isSeq } from "yaml";
import type { Node } from "yaml";
import { childAt } from "../util.ts";
import type { Rule } from "../types.ts";

export const noTagDuplicates: Rule = {
  name: "tags/no-duplicates",
  description: "Requires every tag in the root tags list to have a unique name.",
  defaultSeverity: "error",
  check(ctx) {
    const root = ctx.entryDoc.yamlDoc.contents;
    if (!root || !isMap(root)) return;
    const tagsNode = childAt(root, "tags");
    if (!tagsNode || !isSeq(tagsNode)) return;

    const seen = new Map<string, Node | undefined>();

    for (const item of tagsNode.items) {
      if (!isMap(item)) continue;
      const nameNode = childAt(item, "name");
      if (!isScalar(nameNode) || typeof nameNode.value !== "string" || nameNode.value === "") continue;

      const name = nameNode.value;
      const existing = seen.get(name);
      if (existing) {
        ctx.report(
          { doc: ctx.entryDoc, node: nameNode },
          `Duplicate tag name "${name}".`,
        );
      } else {
        seen.set(name, nameNode);
      }
    }
  },
};
