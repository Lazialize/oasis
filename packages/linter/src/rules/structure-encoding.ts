import { isMap, isNode, isScalar } from "yaml";
import type { Node } from "yaml";
import type { OasisDocument } from "@oasis/core";
import { iterateMediaTypes } from "../openapi-walk.ts";
import { childAt, keyToString, resolveMaybeRef } from "../util.ts";
import type { Rule, RuleContext } from "../types.ts";

/** Valid `style` values for an Encoding Object (same vocabulary as query-param style). */
const VALID_STYLES = new Set(["form", "spaceDelimited", "pipeDelimited", "deepObject"]);

/**
 * Property names of `schemaNode`'s resolved target, if it resolves (within the workspace graph)
 * to an inline object schema with a literal `properties` map. Returns `undefined` when the schema
 * can't be resolved to such a shape (composed schemas, free-form objects, unresolvable refs, …),
 * in which case the encoding-key check is skipped rather than guessed at.
 */
function schemaPropertyNames(ctx: RuleContext, doc: OasisDocument, schemaNode: Node): Set<string> | undefined {
  const resolved = resolveMaybeRef(ctx.graph, doc, schemaNode, "");
  if (!isMap(resolved.node)) return undefined;
  const properties = childAt(resolved.node, "properties");
  if (!isMap(properties)) return undefined;
  return new Set(properties.items.map((pair) => keyToString(pair.key)));
}

function checkEncodingEntry(ctx: RuleContext, doc: OasisDocument, name: string, node: Node, label: string): void {
  if (!isMap(node)) {
    ctx.report({ doc, node }, `${label} encoding "${name}" must be an object.`);
    return;
  }

  const contentType = childAt(node, "contentType");
  if (contentType && (!isScalar(contentType) || typeof contentType.value !== "string")) {
    ctx.report({ doc, node: contentType }, `${label} encoding "${name}" "contentType" must be a string.`);
  }

  const style = childAt(node, "style");
  if (style && (!isScalar(style) || typeof style.value !== "string" || !VALID_STYLES.has(style.value))) {
    ctx.report(
      { doc, node: style },
      `${label} encoding "${name}" "style" must be one of: ${[...VALID_STYLES].join(", ")}.`,
    );
  }

  for (const field of ["explode", "allowReserved"] as const) {
    const fieldNode = childAt(node, field);
    if (fieldNode && (!isScalar(fieldNode) || typeof fieldNode.value !== "boolean")) {
      ctx.report({ doc, node: fieldNode }, `${label} encoding "${name}" "${field}" must be a boolean.`);
    }
  }
}

export const structureEncoding: Rule = {
  name: "structure/encoding",
  description:
    'Checks Encoding Object entries under a Media Type Object\'s "encoding": each key matches a property of the schema (when it resolves to an inline object with literal "properties"), and "contentType"/"style"/"explode"/"allowReserved" have the right shapes.',
  defaultSeverity: "error",
  check(ctx) {
    for (const site of iterateMediaTypes(ctx.graph, ctx.entryDoc, ctx.documents, ctx.version)) {
      const encoding = childAt(site.node, "encoding");
      if (!encoding || !isMap(encoding)) continue;

      const schemaNode = childAt(site.node, "schema");
      const propertyNames = schemaNode ? schemaPropertyNames(ctx, site.doc, schemaNode) : undefined;
      const label = `"${site.pointer}"`;

      for (const pair of encoding.items) {
        const name = keyToString(pair.key);
        if (propertyNames && !propertyNames.has(name) && isNode(pair.key)) {
          ctx.report(
            { doc: site.doc, node: pair.key },
            `${label} encoding key "${name}" does not match any property in the media type's schema.`,
          );
        }
        if (isNode(pair.value)) checkEncodingEntry(ctx, site.doc, name, pair.value, label);
      }
    }
  },
};
