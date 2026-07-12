import { isScalar, isSeq } from "yaml";
import { iterateOperations } from "../openapi-walk.ts";
import { childAt } from "../util.ts";
import type { Rule } from "../types.ts";

export const operationTags: Rule = {
  name: "operation-tags",
  description: "Requires every operation to declare at least one non-empty tag.",
  defaultSeverity: "warn",
  check(ctx) {
    for (const op of iterateOperations(ctx.graph, ctx.entryDoc, ctx.version)) {
      const tagsNode = childAt(op.node, "tags");
      const label = `${op.method.toUpperCase()} ${op.pathItem.template}`;

      if (!tagsNode || !isSeq(tagsNode) || tagsNode.items.length === 0) {
        ctx.report({ doc: op.doc, node: op.node }, `Operation "${label}" has no tags.`);
        continue;
      }

      const hasNonEmptyTag = tagsNode.items.some((item) => isScalar(item) && typeof item.value === "string" && item.value !== "");
      if (!hasNonEmptyTag) {
        ctx.report({ doc: op.doc, node: tagsNode }, `Operation "${label}" has only empty tag values.`);
      }
    }
  },
};
