import { isMap, isNode, isScalar, isSeq } from "yaml";
import type { Node } from "yaml";
import { COMPONENT_SECTIONS, findRefs, graphReferences, resolveAlias, resolveRef } from "@oasis/core";
import type { OasisDocument } from "@oasis/core";
import { iterateOperations } from "../openapi-walk.ts";
import { childAt, classifyMappingValue, keyToString } from "../util.ts";
import type { Rule, RuleContext } from "../types.ts";

// Unused-detection for `pathItems` (3.1-only) isn't supported yet, so it's excluded here.
export const COMPONENT_CATEGORIES = COMPONENT_SECTIONS.filter((section) => section !== "pathItems");

/** Collect security scheme names referenced by name in a `security` requirement array node. */
function collectSecurityNames(doc: OasisDocument, securityNode: Node | undefined, into: Set<string>): void {
  if (!securityNode) return;
  const resolvedSecurity = resolveAlias(securityNode, doc.yamlDoc) ?? securityNode;
  if (!isSeq(resolvedSecurity)) return;
  for (const item of resolvedSecurity.items) {
    if (!isNode(item)) continue;
    const requirement = resolveAlias(item, doc.yamlDoc) ?? item;
    if (!isMap(requirement)) continue;
    for (const pair of requirement.items) into.add(keyToString(pair.key));
  }
}

/** Every security scheme name referenced by any `security` requirement (root or operation, including 3.1 webhooks). */
function collectUsedSecuritySchemeNames(ctx: RuleContext): Set<string> {
  const names = new Set<string>();
  const root = ctx.entryDoc.yamlDoc.contents;
  if (root && isMap(root)) collectSecurityNames(ctx.entryDoc, childAt(root, "security"), names);
  for (const op of iterateOperations(ctx.graph, ctx.entryDoc, ctx.version)) {
    collectSecurityNames(op.doc, childAt(op.node, "security"), names);
  }
  return names;
}

/** Every `discriminator.mapping` value found anywhere in `doc`, regardless of whether the enclosing schema is reachable. */
function collectDiscriminatorMappingValues(doc: OasisDocument): string[] {
  const values: string[] = [];
  const root = doc.yamlDoc.contents;
  if (isNode(root)) walk(root, new Set());
  return values;

  function walk(node: Node, ancestors: Set<Node>): void {
    const resolved = resolveAlias(node, doc.yamlDoc);
    if (!resolved || ancestors.has(resolved)) return;
    ancestors.add(resolved);
    if (isMap(resolved)) {
      for (const pair of resolved.items) {
        const value = isNode(pair.value) ? resolveAlias(pair.value, doc.yamlDoc) : undefined;
        if (isScalar(pair.key) && pair.key.value === "discriminator" && value && isMap(value)) {
          const mappingNode = childAt(value, "mapping");
          if (isMap(mappingNode)) {
            for (const mappingPair of mappingNode.items) {
              if (isNode(mappingPair.value)) {
                const value = resolveAlias(mappingPair.value, doc.yamlDoc) ?? mappingPair.value;
                if (isScalar(value) && typeof value.value === "string") values.push(value.value);
              }
            }
          }
        }
        if (isNode(pair.value)) walk(pair.value, ancestors);
      }
    } else if (isSeq(resolved)) {
      for (const item of resolved.items) {
        if (isNode(item)) walk(item, ancestors);
      }
    }
    ancestors.delete(resolved);
  }
}

/**
 * Documents whose `$ref`s / discriminator mappings count as usage: this graph's own documents plus
 * any `externalDocuments` from sibling project entries (see `RuleContext.externalDocuments`). Refs
 * in an external document still resolve through `ctx.graph`: they only mark a component used when
 * they land on a file this graph also loads (the shared file the two entries have in common), which
 * is exactly the case that matters here.
 */
function usageDocuments(ctx: RuleContext): OasisDocument[] {
  return ctx.externalDocuments && ctx.externalDocuments.length > 0 ? [...ctx.documents, ...ctx.externalDocuments] : ctx.documents;
}

/**
 * If `pointer` addresses something *below* a top-level component — `/components/<section>/<name>`
 * followed by a deeper path (e.g. `/components/schemas/Foo/properties/id`) — return the enclosing
 * component pointer `/components/<section>/<name>`. A `$ref` into a component's interior still
 * *uses* that component (issue #36), so the whole component must count as referenced.
 */
function enclosingComponentPointer(pointer: string): string | undefined {
  const segments = pointer.split("/"); // e.g. ["", "components", "schemas", "Foo", "properties", "id"]
  if (segments.length > 4 && segments[1] === "components") {
    return `/${segments[1]}/${segments[2]}/${segments[3]}`;
  }
  return undefined;
}

/** Record a resolved reference target as used, crediting the enclosing top-level component too (#36). */
function markUsed(used: Set<string>, filePath: string, pointer: string): void {
  used.add(`${filePath}::${pointer}`);
  const enclosing = enclosingComponentPointer(pointer);
  if (enclosing) used.add(`${filePath}::${enclosing}`);
}

/** Mark components resolved from `discriminator.mapping` values (reference or bare-name form) as used. */
function collectDiscriminatorMappingUsage(ctx: RuleContext, used: Set<string>): void {
  for (const doc of usageDocuments(ctx)) {
    for (const value of collectDiscriminatorMappingValues(doc)) {
      const target = classifyMappingValue(value);
      if (target.kind === "external") continue; // absolute non-filesystem URI, not a workspace component
      const result = resolveRef(ctx.graph, doc, target.ref);
      if (result.ok) markUsed(used, result.doc.filePath, result.pointer);
    }
  }
}

export const noUnusedComponents: Rule = {
  name: "components/no-unused",
  description:
    "Flags components that are defined but never referenced by any $ref in the workspace, and never referenced by name (security scheme names in a \"security\" requirement, or discriminator mapping values).",
  defaultSeverity: "warn",
  check(ctx) {
    const used = new Set<string>();
    for (const doc of ctx.documents) {
      for (const ref of graphReferences(ctx.graph, doc)) {
        const result = resolveRef(ctx.graph, doc, ref);
        if (result.ok) markUsed(used, result.doc.filePath, result.pointer);
      }
    }
    // Sibling-entry documents arrive without their owning graph, so retain syntactic discovery for
    // that cross-entry compatibility path. Documents owned by this graph always use semantic refs.
    for (const doc of ctx.externalDocuments ?? []) {
      for (const ref of findRefs(doc)) {
        const result = resolveRef(ctx.graph, doc, ref);
        if (result.ok) markUsed(used, result.doc.filePath, result.pointer);
      }
    }
    collectDiscriminatorMappingUsage(ctx, used);
    const usedSecuritySchemeNames = collectUsedSecuritySchemeNames(ctx);

    for (const doc of ctx.documents) {
      const root = doc.yamlDoc.contents;
      if (!root || !isMap(root)) continue;
      const componentsNode = childAt(root, "components");
      if (!componentsNode || !isMap(componentsNode)) continue;

      for (const category of COMPONENT_CATEGORIES) {
        const categoryNode = childAt(componentsNode, category);
        if (!categoryNode || !isMap(categoryNode)) continue;

        for (const pair of categoryNode.items) {
          const name = keyToString(pair.key);
          const pointer = `/components/${category}/${name}`;
          if (used.has(`${doc.filePath}::${pointer}`)) continue;
          // Requirement keys are implicit component-name references that resolve against the
          // *entry* document per OpenAPI scope rules (see `security/defined`), so a by-name usage
          // only exempts the entry document's scheme — a same-named scheme in a referenced file is
          // a different, unreachable component.
          if (category === "securitySchemes" && doc === ctx.entryDoc && usedSecuritySchemeNames.has(name)) continue;

          ctx.report({ doc, pointer }, `Component "${name}" in "components/${category}" is not used anywhere in the workspace.`);
        }
      }
    }
  },
};
