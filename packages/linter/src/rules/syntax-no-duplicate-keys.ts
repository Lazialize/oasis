import type { Rule } from "../types.ts";

/** Surfaces core's duplicate-key detection through the lint pipeline. */
export const noDuplicateKeys: Rule = {
  name: "syntax/no-duplicate-keys",
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
