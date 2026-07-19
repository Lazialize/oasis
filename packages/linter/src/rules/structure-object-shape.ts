import { isMap, isNode, isSeq } from "yaml";
import type { Node } from "yaml";
import type { OasisDocument } from "@oasis/core";
import { childAt } from "../util.ts";
import { iterateOperations } from "../openapi-walk.ts";
import { OBJECT_SHAPES, validateObjectShape } from "../object-shape.ts";
import type { ObjectKind } from "../object-shape.ts";
import type { Rule } from "../types.ts";

/**
 * Table-driven structural validation for the metadata objects the other `structure/*` rules don't
 * cover: Info, Contact, License, Tag, and External Documentation Objects. Each is validated against
 * its `OBJECT_SHAPES` entry (required fields, field types, version availability, mutual exclusion,
 * extension allowance), so coverage of these objects can't silently drift as 3.1 fields are added —
 * it's described once in `object-shape.ts` and shared with the LSP completion contexts.
 *
 * Objects with dedicated rules (Schema, Parameter, Response, Security Scheme, Server, Path Item,
 * Operation, ...) are intentionally left to those rules to avoid duplicate diagnostics; this rule
 * only fills the gaps the shape table exists to close. (Server Objects are fully validated by
 * `structure/server-variables`.)
 */
export const structureObjectShape: Rule = {
  name: "structure/object-shape",
  description:
    "Validates Info, Contact, License, Tag, and External Documentation Objects against a version-aware shape table.",
  defaultSeverity: "error",
  check(ctx) {
    const doc = ctx.entryDoc;
    const version = ctx.version ?? "3.1";
    const root = doc.yamlDoc.contents;
    if (!root || !isMap(root)) return;

    const validateIn = (kind: ObjectKind, targetDoc: OasisDocument, node: Node | undefined, label: string): void => {
      if (!node || !isNode(node)) return;
      validateObjectShape(OBJECT_SHAPES[kind], node, version, label, (n, message) => {
        ctx.report({ doc: targetDoc, node: n }, message);
      });
    };
    const validate = (kind: ObjectKind, node: Node | undefined, label: string): void => validateIn(kind, doc, node, label);

    // Info Object and its nested Contact / License Objects.
    const info = childAt(root, "info");
    if (info && isMap(info)) {
      validate("info", info, '"info"');
      validate("contact", childAt(info, "contact"), '"info.contact"');
      validate("license", childAt(info, "license"), '"info.license"');
    }

    // External Documentation Objects at the root, on tags, and on operations.
    validate("externalDocs", childAt(root, "externalDocs"), '"externalDocs"');

    // Tag Objects (and their External Documentation Objects).
    const tags = childAt(root, "tags");
    if (tags && isSeq(tags)) {
      tags.items.forEach((tag, i) => {
        if (!isNode(tag)) return;
        validate("tag", tag, `"tags[${i}]"`);
        if (isMap(tag)) validate("externalDocs", childAt(tag, "externalDocs"), `"tags[${i}].externalDocs"`);
      });
    }

    for (const op of iterateOperations(ctx.graph, ctx.entryDoc, ctx.version)) {
      if (!isMap(op.node)) continue;
      validateIn("externalDocs", op.doc, childAt(op.node, "externalDocs"), `"${op.pointer}/externalDocs"`);
    }

  },
};
