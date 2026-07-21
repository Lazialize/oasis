import { isMap, isNode, isSeq } from "yaml";
import type { Node } from "yaml";
import type { OasisDocument } from "@oasis/core";
import { childAt } from "../util.ts";
import { iterateOperations } from "../openapi-walk.ts";
import { OBJECT_SHAPES, validateObjectShape } from "../object-shape.ts";
import type { ObjectKind } from "../object-shape.ts";
import type { Rule } from "../types.ts";

/**
 * Root fields whose presence/type/version is already fully diagnosed by other structural rules:
 * "openapi" and "info" required-ness is `structure/required-fields`'s job (which also type-checks
 * "info" and its "title"/"version"); "openapi" and "$self" type and version-gating is
 * `structure/openapi-version`'s job; the array/object type-checks for "servers", "tags", "security",
 * "paths", "components", and "webhooks" belong to `structure/field-types`. This rule still uses the
 * root shape's full field table for unknown-field detection (every key must be declared or an "x-"
 * extension) and still enforces "webhooks"'s version gate (3.1+), which nothing else checks.
 */
const ROOT_SKIP_REQUIRED = new Set(["openapi", "info"]);
const ROOT_SKIP_TYPE_CHECK = new Set([
  "openapi",
  "info",
  "servers",
  "paths",
  "components",
  "security",
  "tags",
  "webhooks",
  "$self",
]);
const ROOT_SKIP_VERSION_CHECK = new Set(["$self"]);

/**
 * Table-driven structural validation for the objects the other `structure/*` rules don't fully
 * cover: the root OpenAPI Object itself, and Info, Contact, License, Tag, and External Documentation
 * Objects. Each is validated against its `OBJECT_SHAPES` entry (required fields, field types, version
 * availability, mutual exclusion, extension allowance), so coverage of these objects can't silently
 * drift as 3.1/3.2 fields are added — it's described once in `object-shape.ts` and shared with the
 * LSP completion contexts.
 *
 * Objects with dedicated rules (Schema, Parameter, Response, Security Scheme, Server, Path Item,
 * Operation, ...) are intentionally left to those rules to avoid duplicate diagnostics; this rule
 * only fills the gaps the shape table exists to close. (Server Objects are fully validated by
 * `structure/server-variables`.) The root object is validated with the specific checks already owned
 * by `structure/required-fields`, `structure/openapi-version`, and `structure/field-types` skipped
 * (see `ROOT_SKIP_*` above), so this rule adds only unknown-root-field detection and the "webhooks"
 * / "jsonSchemaDialect" version gates and "jsonSchemaDialect" type check that nothing else performs.
 */
export const structureObjectShape: Rule = {
  name: "structure/object-shape",
  description:
    "Validates the root OpenAPI Object, Info, Contact, License, Tag, and External Documentation Objects against a version-aware shape table.",
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

    // The root OpenAPI Object: unknown-field detection plus the version gates and field types not
    // already covered by structure/required-fields, structure/openapi-version, and
    // structure/field-types (see ROOT_SKIP_* above).
    validateObjectShape(
      OBJECT_SHAPES.root,
      root,
      version,
      '"root"',
      (n, message) => ctx.report({ doc, node: n }, message),
      {
        skipRequired: ROOT_SKIP_REQUIRED,
        skipTypeCheck: ROOT_SKIP_TYPE_CHECK,
        skipVersionCheck: ROOT_SKIP_VERSION_CHECK,
      },
    );

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
