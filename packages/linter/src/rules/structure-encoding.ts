import { isMap, isNode, isScalar, isSeq } from "yaml";
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

  checkNestedEncodings(ctx, doc, node, `${label} encoding "${name}"`);
}

function checkNestedEncodings(ctx: RuleContext, doc: OasisDocument, node: Node, label: string, includeEncodingEntries = true): void {
  if (!isMap(node)) return;
  const encoding = childAt(node, "encoding");
  const prefixEncoding = childAt(node, "prefixEncoding");
  const itemEncoding = childAt(node, "itemEncoding");

  for (const [field, value] of [["encoding", encoding], ["prefixEncoding", prefixEncoding], ["itemEncoding", itemEncoding]] as const) {
    const nestedEncodingField = field === "encoding" && includeEncodingEntries;
    if (value && ctx.version !== "3.2" && (field !== "encoding" || nestedEncodingField)) {
      ctx.report({ doc, node: value }, `${label} field "${field}" is only valid in OpenAPI 3.2.`);
    }
  }
  if (encoding && (prefixEncoding || itemEncoding)) {
    ctx.report({ doc, node }, `${label} must not combine "encoding" with "prefixEncoding" or "itemEncoding".`);
  }
  if (includeEncodingEntries && encoding && isMap(encoding)) {
    for (const pair of encoding.items) {
      if (isNode(pair.value)) checkEncodingEntry(ctx, doc, keyToString(pair.key), pair.value, label);
    }
  }
  if (prefixEncoding) {
    if (!isSeq(prefixEncoding)) {
      ctx.report({ doc, node: prefixEncoding }, `${label} "prefixEncoding" must be an array.`);
    } else {
      prefixEncoding.items.forEach((item, index) => {
        if (isNode(item)) checkEncodingEntry(ctx, doc, String(index), item, `${label}.prefixEncoding`);
      });
    }
  }
  if (itemEncoding) checkEncodingEntry(ctx, doc, "itemEncoding", itemEncoding, label);
}

export const structureEncoding: Rule = {
  name: "structure/encoding",
  description:
    'Checks Encoding Object entries under a Media Type Object\'s "encoding": each key matches a property of the schema (when it resolves to an inline object with literal "properties"), and "contentType"/"style"/"explode"/"allowReserved" have the right shapes.',
  defaultSeverity: "error",
  check(ctx) {
    for (const site of iterateMediaTypes(ctx.graph, ctx.entryDoc, ctx.documents, ctx.version)) {
      const itemSchema = childAt(site.node, "itemSchema");
      if (itemSchema && ctx.version !== "3.2") {
        ctx.report({ doc: site.doc, node: itemSchema }, `"${site.pointer}" field "itemSchema" is only valid in OpenAPI 3.2.`);
      } else if (itemSchema && !isMap(itemSchema) && !(isScalar(itemSchema) && typeof itemSchema.value === "boolean")) {
        ctx.report({ doc: site.doc, node: itemSchema }, `"${site.pointer}.itemSchema" must be a Schema Object or boolean schema.`);
      }
      checkNestedEncodings(ctx, site.doc, site.node, `"${site.pointer}"`, false);
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
