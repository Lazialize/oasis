import { isMap } from "yaml";
import { iterateOperations } from "../openapi-walk.ts";
import { childAt, keyToString } from "../util.ts";
import type { Rule } from "../types.ts";

/** Literal 2xx/3xx status code keys as written per the OpenAPI spec: "200" or "2XX" (uppercase). */
const SUCCESS_STATUS = /^[23](\d{2}|XX)$/;

export const operationSuccessResponse: Rule = {
  name: "operation/success-response",
  description: 'Requires every operation to declare at least one 2xx or 3xx response (a lone "default" does not count).',
  defaultSeverity: "warn",
  check(ctx) {
    for (const op of iterateOperations(ctx.graph, ctx.entryDoc, ctx.version)) {
      const label = `${op.method.toUpperCase()} ${op.pathItem.template}`;
      const responsesNode = childAt(op.node, "responses");

      if (!responsesNode || !isMap(responsesNode)) {
        ctx.report({ doc: op.doc, node: op.node }, `Operation "${label}" has no "responses" object.`);
        continue;
      }

      const hasSuccess = responsesNode.items.some((pair) => SUCCESS_STATUS.test(keyToString(pair.key)));
      if (!hasSuccess) {
        ctx.report(
          { doc: op.doc, node: responsesNode },
          `Operation "${label}" has no 2xx or 3xx response ("default" alone does not satisfy this).`,
        );
      }
    }
  },
};
