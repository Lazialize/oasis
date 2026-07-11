import { iteratePathItems } from "../openapi-walk.ts";
import type { Rule } from "../types.ts";

/**
 * Normalize a path template so that templates differing only in parameter names compare equal:
 * `/users/{id}` and `/users/{userId}` both become `/users/{}`.
 */
function normalizeTemplate(template: string): string {
  return template
    .split("/")
    .map((segment) => (/^\{.+\}$/.test(segment) ? "{}" : segment))
    .join("/");
}

export const noDuplicatePaths: Rule = {
  name: "no-duplicate-paths",
  description: "Flags path templates that are equivalent up to parameter names (e.g. /users/{id} vs /users/{userId}).",
  defaultSeverity: "error",
  check(ctx) {
    const seen = new Map<string, string>();

    for (const pathItem of iteratePathItems(ctx.graph, ctx.entryDoc)) {
      const normalized = normalizeTemplate(pathItem.template);
      const first = seen.get(normalized);
      if (first === undefined) {
        seen.set(normalized, pathItem.template);
        continue;
      }
      if (!pathItem.keyNode) continue;
      ctx.report(
        { doc: ctx.entryDoc, node: pathItem.keyNode },
        `Path "${pathItem.template}" conflicts with "${first}": both resolve to the same template shape once parameter names are ignored.`,
      );
    }
  },
};
