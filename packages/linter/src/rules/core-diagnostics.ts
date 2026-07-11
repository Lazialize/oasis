import { findRefs, resolveRef } from "@oasis/core";
import type { Rule } from "../types.ts";

/** Surfaces core's duplicate-key detection through the lint pipeline. */
export const noDuplicateKeys: Rule = {
  name: "no-duplicate-keys",
  description: "Flags duplicate keys within a YAML/JSON mapping.",
  defaultSeverity: "error",
  check(ctx) {
    for (const doc of ctx.documents) {
      for (const d of doc.diagnostics) {
        if (d.code === "no-duplicate-keys") ctx.report(d.range, d.message);
      }
    }
  },
};

/**
 * Flags every $ref that cannot be resolved to a target file or pointer, whether the failure is a
 * missing/unloadable file (already recorded on the graph at load time) or a pointer that doesn't
 * exist within an otherwise-loaded document (only detectable by actually resolving the ref).
 */
export const noUnresolvedRef: Rule = {
  name: "no-unresolved-ref",
  description: "Flags $ref values that cannot be resolved to a target file or pointer.",
  defaultSeverity: "error",
  check(ctx) {
    for (const doc of ctx.documents) {
      for (const ref of findRefs(doc)) {
        const result = resolveRef(ctx.graph, doc, ref.value, ref.range);
        if (!result.ok) ctx.report(result.diagnostic.range, result.diagnostic.message);
      }
    }
  },
};

/** Surfaces core's $ref cycle detection through the lint pipeline. */
export const noRefCycle: Rule = {
  name: "no-ref-cycle",
  description: "Flags circular $ref chains.",
  defaultSeverity: "warn",
  check(ctx) {
    for (const d of ctx.graph.diagnostics) {
      if (d.code === "no-ref-cycle") ctx.report(d.range, d.message);
    }
  },
};
