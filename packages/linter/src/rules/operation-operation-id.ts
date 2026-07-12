import { isScalar } from "yaml";
import { iterateOperations } from "../openapi-walk.ts";
import { childAt } from "../util.ts";
import type { Rule } from "../types.ts";

export const operationOperationId: Rule = {
  name: "operation/operation-id",
  description: "Requires every operation to declare a unique operationId across the workspace.",
  defaultSeverity: "error",
  check(ctx) {
    const seen = new Map<string, { pathTemplate: string; method: string }>();

    for (const op of iterateOperations(ctx.graph, ctx.entryDoc, ctx.version)) {
      const idNode = childAt(op.node, "operationId");
      if (!idNode || !isScalar(idNode) || typeof idNode.value !== "string" || idNode.value === "") {
        ctx.report(
          { doc: op.doc, node: op.node },
          `Operation "${op.method.toUpperCase()} ${op.pathItem.template}" is missing an operationId.`,
        );
        continue;
      }

      const id = idNode.value;
      const existing = seen.get(id);
      if (existing) {
        ctx.report(
          { doc: op.doc, node: idNode },
          `Duplicate operationId "${id}" (also used by "${existing.method.toUpperCase()} ${existing.pathTemplate}").`,
        );
      } else {
        seen.set(id, { pathTemplate: op.pathItem.template, method: op.method });
      }
    }
  },
};
