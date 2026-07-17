import { graphReferences, resolveRef } from "@oasis/core";
import type { Rule } from "../types.ts";

/**
 * Flags every `$ref` or `$dynamicRef` static fallback that cannot be resolved to a target file or pointer, whether the failure is a
 * missing/unloadable file (already recorded on the graph at load time) or a pointer that doesn't
 * exist within an otherwise-loaded document (only detectable by actually resolving the ref).
 */
export const noUnresolvedRef: Rule = {
  name: "refs/no-unresolved",
  description: "Flags $ref and $dynamicRef values that cannot be resolved to a target file or pointer.",
  defaultSeverity: "error",
  check(ctx) {
    for (const doc of ctx.documents) {
      for (const ref of graphReferences(ctx.graph, doc)) {
        const result = resolveRef(ctx.graph, doc, ref);
        if (!result.ok) ctx.report(result.diagnostic.range, result.diagnostic.message);
      }
    }
  },
};
