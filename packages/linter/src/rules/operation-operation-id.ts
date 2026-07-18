import { isScalar } from "yaml";
import type { Node } from "yaml";
import type { OasisDocument } from "@oasis/core";
import { iterateOperations } from "../openapi-walk.ts";
import { childAt } from "../util.ts";
import type { Rule } from "../types.ts";

interface OperationWithId {
  doc: OasisDocument;
  idNode: Node;
  pathTemplate: string;
  method: string;
}

export const operationOperationId: Rule = {
  name: "operation/operation-id",
  description: "Requires every operation to declare a unique operationId across the workspace.",
  defaultSeverity: "error",
  check(ctx) {
    const operationsById = new Map<string, OperationWithId[]>();

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
      const operations = operationsById.get(id) ?? [];
      operations.push({ doc: op.doc, idNode, pathTemplate: op.pathItem.template, method: op.method });
      operationsById.set(id, operations);
    }

    for (const [id, operations] of operationsById) {
      if (operations.length < 2) continue;
      // Traversal follows the entry document's map order, which must not decide the diagnostic's
      // owner. Sort source locations, then use a stable witness for every reported occurrence.
      const sorted = [...operations].sort((a, b) => {
        if (a.doc.filePath !== b.doc.filePath) return a.doc.filePath < b.doc.filePath ? -1 : 1;
        const offsetDifference = (a.idNode.range?.[0] ?? 0) - (b.idNode.range?.[0] ?? 0);
        if (offsetDifference !== 0) return offsetDifference;
        if (a.pathTemplate !== b.pathTemplate) return a.pathTemplate < b.pathTemplate ? -1 : 1;
        return a.method < b.method ? -1 : a.method > b.method ? 1 : 0;
      });
      const enabled = sorted.filter((operation) => ctx.isEnabledFor(operation.doc.filePath));
      if (enabled.length === 0) continue;
      const witness = enabled.length === sorted.length
        ? sorted[0]
        : sorted.find((operation) => !ctx.isEnabledFor(operation.doc.filePath));
      if (!witness) continue;

      const reportable = enabled.length === sorted.length
        ? sorted.filter((operation) => operation !== witness)
        : enabled;
      for (const operation of reportable) {
        ctx.report(
          { doc: operation.doc, node: operation.idNode },
          `Duplicate operationId "${id}" (also used by "${witness.method.toUpperCase()} ${witness.pathTemplate}").`,
        );
      }
    }
  },
};
