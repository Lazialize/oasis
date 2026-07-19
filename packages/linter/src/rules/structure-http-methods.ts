import { isMap, isNode } from "yaml";
import { HTTP_METHODS, iteratePathItems, PATH_ITEM_NON_METHOD_KEYS } from "../openapi-walk.ts";
import { keyToString } from "../util.ts";
import type { Rule } from "../types.ts";

const PRE_32_METHODS = new Set<string>(HTTP_METHODS.filter((method) => method !== "query"));
const FIXED_METHOD_TOKENS = new Set<string>(HTTP_METHODS.map((method) => method.toUpperCase()));

export const structureHttpMethods: Rule = {
  name: "structure/http-methods",
  description: "Requires keys directly under a Path Item Object to be valid HTTP methods or allowed metadata fields.",
  defaultSeverity: "error",
  check(ctx) {
    for (const pathItem of iteratePathItems(ctx.graph, ctx.entryDoc, ctx.version)) {
      if (!isMap(pathItem.node)) continue;
      const allowedKeys = new Set<string>([
        ...(ctx.version === "3.2" ? HTTP_METHODS : PRE_32_METHODS),
        ...[...PATH_ITEM_NON_METHOD_KEYS].filter((key) => key !== "additionalOperations" || ctx.version === "3.2"),
      ]);

      for (const pair of pathItem.node.items) {
        const key = keyToString(pair.key);
        if (!allowedKeys.has(key) && !key.startsWith("x-") && isNode(pair.key)) {
          ctx.report(
            { doc: pathItem.doc, node: pair.key },
            `"${key}" is not a valid key under path item "${pathItem.template}" (expected an HTTP method or one of: ${[...PATH_ITEM_NON_METHOD_KEYS].join(", ")}).`,
          );
        }
      }

      if (ctx.version === "3.2") {
        const additional = pathItem.node.items.find((pair) => keyToString(pair.key) === "additionalOperations")?.value;
        if (additional && isNode(additional)) {
          if (!isMap(additional)) {
            ctx.report({ doc: pathItem.doc, node: additional }, '"additionalOperations" must be an object.');
          } else {
            for (const pair of additional.items) {
              const method = keyToString(pair.key);
              if (FIXED_METHOD_TOKENS.has(method) && isNode(pair.key)) {
                ctx.report({ doc: pathItem.doc, node: pair.key },
                  `"additionalOperations" must not redefine fixed HTTP method "${method}".`);
              }
              if (isNode(pair.value) && !isMap(pair.value)) {
                ctx.report({ doc: pathItem.doc, node: pair.value },
                  `Additional operation "${method}" must be an object.`);
              }
            }
          }
        }
      }
    }
  },
};
