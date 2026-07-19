import { isMap, isScalar } from "yaml";
import { childAt } from "../util.ts";
import type { Rule } from "../types.ts";

// Mirrors the supported OpenAPI feature sets for the `openapi` field.
const VALID_VERSION = /^3\.[012]\.\d+(-.+)?$/;

export const structureOpenapiVersion: Rule = {
  name: "structure/openapi-version",
  description: 'Requires the "openapi" field to be a valid 3.0.x, 3.1.x, or 3.2.x version string.',
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
        `"openapi" value "${versionNode.value}" is not a valid 3.0.x, 3.1.x, or 3.2.x version (Swagger 2.0 is not supported).`,
      );
    }

    const selfNode = childAt(root, "$self");
    if (selfNode) {
      if (ctx.version !== "3.2") {
        ctx.report({ doc: ctx.entryDoc, node: selfNode }, '"$self" is only valid in OpenAPI 3.2.');
      } else if (!isScalar(selfNode) || typeof selfNode.value !== "string" || selfNode.value === "") {
        ctx.report({ doc: ctx.entryDoc, node: selfNode }, '"$self" must be a non-empty URI string.');
      }
    }
  },
};
