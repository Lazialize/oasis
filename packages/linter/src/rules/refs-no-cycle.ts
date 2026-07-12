import type { Rule } from "../types.ts";

/** Surfaces core's $ref cycle detection through the lint pipeline. */
export const noRefCycle: Rule = {
  name: "refs/no-cycle",
  description: "Flags circular $ref chains.",
  defaultSeverity: "warn",
  check(ctx) {
    for (const d of ctx.graph.diagnostics) {
      if (d.code === "no-ref-cycle") ctx.report(d.range, d.message);
    }
  },
};
