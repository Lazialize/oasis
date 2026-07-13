import { isMap, isNode } from "yaml";
import { HTTP_METHODS, iteratePathItems, PATH_ITEM_NON_METHOD_KEYS } from "../openapi-walk.ts";
import { keyToString } from "../util.ts";
import type { Rule } from "../types.ts";

const ALLOWED_KEYS = new Set<string>([...HTTP_METHODS, ...PATH_ITEM_NON_METHOD_KEYS]);

export const structureHttpMethods: Rule = {
  name: "structure/http-methods",
  description: "Requires keys directly under a Path Item Object to be valid HTTP methods or allowed metadata fields.",
  defaultSeverity: "error",
  check(ctx) {
    for (const pathItem of iteratePathItems(ctx.graph, ctx.entryDoc, ctx.version)) {
      if (!isMap(pathItem.node)) continue;

      for (const pair of pathItem.node.items) {
        const key = keyToString(pair.key);
        if (!ALLOWED_KEYS.has(key) && isNode(pair.key)) {
          ctx.report(
            { doc: pathItem.doc, node: pair.key },
            `"${key}" is not a valid key under path item "${pathItem.template}" (expected an HTTP method or one of: ${[...PATH_ITEM_NON_METHOD_KEYS].join(", ")}).`,
          );
        }
      }
    }
  },
};
