import { isMap, isNode } from "yaml";
import { HTTP_METHODS, PATH_ITEM_NON_METHOD_KEYS } from "../openapi-walk.ts";
import { childAt, keyToString } from "../util.ts";
import type { Rule } from "../types.ts";

const ALLOWED_KEYS = new Set<string>([...HTTP_METHODS, ...PATH_ITEM_NON_METHOD_KEYS]);

export const structureHttpMethods: Rule = {
  name: "structure/http-methods",
  description: "Requires keys directly under a Path Item Object to be valid HTTP methods or allowed metadata fields.",
  defaultSeverity: "error",
  check(ctx) {
    const doc = ctx.entryDoc;
    const root = doc.yamlDoc.contents;
    if (!root || !isMap(root)) return;

    const paths = childAt(root, "paths");
    if (!paths || !isMap(paths)) return;

    for (const pathPair of paths.items) {
      const template = keyToString(pathPair.key);
      if (!isNode(pathPair.value) || !isMap(pathPair.value)) continue;

      for (const pair of pathPair.value.items) {
        const key = keyToString(pair.key);
        if (!ALLOWED_KEYS.has(key) && isNode(pair.key)) {
          ctx.report(
            { doc, node: pair.key },
            `"${key}" is not a valid key under path item "${template}" (expected an HTTP method or one of: ${[...PATH_ITEM_NON_METHOD_KEYS].join(", ")}).`,
          );
        }
      }
    }
  },
};
