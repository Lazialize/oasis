import { isMap, isScalar } from "yaml";
import { childAt } from "../util.ts";
import type { Rule } from "../types.ts";

// Mirrors the official OpenAPI schema pattern `^3\.[01]\.\d+(-.+)?$` for the `openapi` field.
const VALID_VERSION = /^3\.[01]\.\d+(-.+)?$/;

export const structureOpenapiVersion: Rule = {
  name: "structure/openapi-version",
  description: 'Requires the "openapi" field to be a valid 3.0.x or 3.1.x version string.',
  defaultSeverity: "error",
  check(ctx) {
    const root = ctx.entryDoc.yamlDoc.contents;
    if (!root || !isMap(root)) return;

    const versionNode = childAt(root, "openapi");
    if (!versionNode) return; // covered by structure/required-fields

    if (!isScalar(versionNode) || typeof versionNode.value !== "string") {
      ctx.report({ doc: ctx.entryDoc, node: versionNode }, '"openapi" must be a string.');
      return;
    }

    if (!VALID_VERSION.test(versionNode.value)) {
      ctx.report(
        { doc: ctx.entryDoc, node: versionNode },
        `"openapi" value "${versionNode.value}" is not a valid 3.0.x or 3.1.x version (Swagger 2.0 is not supported).`,
      );
    }
  },
};
