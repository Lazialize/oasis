import { isScalar } from "yaml";
import { iterateOperations } from "../openapi-walk.ts";
import { childAt } from "../util.ts";
import type { Rule } from "../types.ts";

function hasNonEmptyString(node: ReturnType<typeof childAt>): boolean {
  return !!node && isScalar(node) && typeof node.value === "string" && node.value.trim() !== "";
}

export const operationDescription: Rule = {
  name: "operation-description",
  description: "Requires every operation to have a description or summary.",
  defaultSeverity: "warn",
  check(ctx) {
    for (const op of iterateOperations(ctx.graph, ctx.entryDoc)) {
      const description = childAt(op.node, "description");
      const summary = childAt(op.node, "summary");
      if (!hasNonEmptyString(description) && !hasNonEmptyString(summary)) {
        ctx.report(
          { doc: op.doc, node: op.node },
          `Operation "${op.method.toUpperCase()} ${op.pathItem.template}" has neither a description nor a summary.`,
        );
      }
    }
  },
};
