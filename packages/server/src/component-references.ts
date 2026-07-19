import { graphReferences, resolveRef } from "@oasis/core";
import type { OasisDocument, Range, WorkspaceGraph } from "@oasis/core";
import { collectNameBasedRefs, componentNameSegmentRange } from "./component-target.ts";
import type { ComponentTarget } from "./component-target.ts";

/**
 * The syntactic context a reference's editable token lives in — governs how a new component name
 * must be encoded there on rename:
 * - `pointer-segment`: a JSON-Pointer segment inside an existing `$ref` string literal. Validated
 *   component names (`[A-Za-z0-9._-]+`) need no escaping inside a string, so the bare name is used.
 * - `yaml-key` / `yaml-scalar`: a bare YAML/JSON mapping key or scalar value (a Security Requirement
 *   key, or a bare discriminator mapping name). The whole token is replaced, so the new name is
 *   re-encoded for the document's syntax (JSON string, or single-quoted YAML when ambiguous).
 */
export type ReferenceContext = "pointer-segment" | "yaml-key" | "yaml-scalar";

/** A single reference to a top-level component, from any of the reference forms Oasis understands. */
export interface ComponentReference {
  filePath: string;
  /** The location find-references reports for this reference (the whole `$ref`/key/value scalar). */
  locationRange: Range;
  /** The exact sub-range rename replaces with the (encoded) new name. */
  nameRange: Range;
  /** The syntactic context of `nameRange`, governing how the new name is encoded there. */
  context: ReferenceContext;
}

/** Whether `filePath` is a JSON/JSONC document (by extension), which quotes mapping keys/values. */
export function isJsonDocument(filePath: string): boolean {
  return /\.jsonc?$/i.test(filePath);
}

/**
 * Whether a component name — already validated to `[A-Za-z0-9._-]+` — would be reinterpreted by
 * YAML as a non-string (number, boolean, null) and therefore needs quoting when written as a bare
 * plain scalar (mapping key or value).
 */
function needsYamlQuoting(name: string): boolean {
  if (/^[-+]?\d+$/.test(name)) return true; // integer-like
  if (/^[-+]?(?:\d*\.\d+|\d+\.\d*)$/.test(name)) return true; // float-like
  if (/^(?:true|false|null|yes|no|on|off|~)$/i.test(name)) return true; // boolean/null-like
  return false;
}

/**
 * Encode `name` for use as a bare mapping key or scalar value in a document of the given syntax.
 * JSON always double-quotes; YAML single-quotes only when the name would otherwise be reinterpreted
 * (validated names contain no `'`, so single-quoting is always safe).
 */
export function encodeComponentName(name: string, filePath: string): string {
  if (isJsonDocument(filePath)) return JSON.stringify(name);
  return needsYamlQuoting(name) ? `'${name}'` : name;
}

/**
 * Every reference to `target` across `referringDocs` (each document paired with a graph that can
 * resolve its `$ref`s): `$ref`s whose resolved pointer is the component or nested under it (so a
 * `$ref` into `.../Foo/properties/id` counts as a reference to `Foo`), plus name-based references
 * (Security Requirement keys, bare discriminator mapping names). This is the single index consumed
 * by find-references and rename, so both agree exactly on what refers to a component.
 */
export function collectComponentReferences(
  target: ComponentTarget,
  referringDocs: Array<{ doc: OasisDocument; graph: WorkspaceGraph }>,
): ComponentReference[] {
  const results: ComponentReference[] = [];
  const nestedPrefix = `${target.pointer}/`;

  for (const { doc, graph } of referringDocs) {
    // `$ref`-based references (this also covers URI-style discriminator mappings, which `findRefs`
    // surfaces). A reference counts when it resolves to the component root or anywhere beneath it.
    for (const ref of graphReferences(graph, doc)) {
      const resolved = resolveRef(graph, doc, ref);
      if (!resolved.ok || resolved.doc.filePath !== target.doc.filePath) continue;
      // Compare canonical (decoded) pointers, not the raw `resolved.pointer` spelling: a ref whose
      // pointer segment is percent-encoded (`%46oo` for `Foo`, RFC 6901 §6) resolves fine but keeps
      // its original encoding in `resolved.pointer`, which would never equal `target.pointer`'s
      // canonical form otherwise.
      if (resolved.canonicalPointer !== target.pointer && !resolved.canonicalPointer.startsWith(nestedPrefix)) continue;
      const nameRange = componentNameSegmentRange(doc, ref.range, target.section, target.name);
      if (!nameRange) continue;
      results.push({ filePath: doc.filePath, locationRange: ref.range, nameRange, context: "pointer-segment" });
    }

    // Name-based references.
    for (const nb of collectNameBasedRefs(doc)) {
      if (nb.section !== target.section || nb.name !== target.name) continue;
      if (nb.section === "securitySchemes") {
        // Security Requirements name schemes in the OpenAPI *root* (entry) document's components.
        if (target.doc.filePath !== graph.entryPath) continue;
        results.push({ filePath: doc.filePath, locationRange: nb.range, nameRange: nb.range, context: "yaml-key" });
      } else {
        // A bare discriminator name refers to a schema in the same document as the discriminator.
        if (doc.filePath !== target.doc.filePath) continue;
        results.push({ filePath: doc.filePath, locationRange: nb.range, nameRange: nb.range, context: "yaml-scalar" });
      }
    }
  }

  return results;
}
