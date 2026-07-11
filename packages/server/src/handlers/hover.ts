import { detectVersion, resolveRef } from "@oasis/core";
import type { Position } from "@oasis/core";
import { classifyPointer } from "../keywords.ts";
import type { ObjectKind } from "../keywords.ts";
import { findRefAtPosition } from "../refs.ts";
import { getChildNode, getChildScalar, mapKeys } from "../yaml-helpers.ts";
import { getDocument, getGraph } from "../workspace.ts";
import type { ServerContext } from "../workspace.ts";

export interface HoverParams {
  path: string;
  position: Position;
}

export interface HoverResult {
  contents: string;
}

const KIND_LABEL: Record<ObjectKind, string> = {
  root: "OpenAPI document",
  info: "Info",
  pathItem: "Path item",
  operation: "Operation",
  parameter: "Parameter",
  requestBody: "Request body",
  responses: "Responses",
  response: "Response",
  mediaType: "Media type",
  schema: "Schema",
  components: "Components",
  securityScheme: "Security scheme",
};

const MAX_PROPERTIES_SHOWN = 10;

/** Cursor on a `$ref` -> a short summary of the resolved target. */
export async function getHover(ctx: ServerContext, params: HoverParams): Promise<HoverResult | undefined> {
  const graph = await getGraph(ctx, params.path);
  const doc = getDocument(graph, params.path);
  if (!doc) return undefined;

  const found = findRefAtPosition(doc, params.position);
  if (!found) return undefined;

  const result = resolveRef(graph, doc, found.refString);
  if (!result.ok) return undefined;

  const kind = classifyPointer(result.pointer) ?? "schema";
  const lines: string[] = [`**${KIND_LABEL[kind]}** \`${result.pointer || "/"}\``];

  const description = getChildScalar(result.node, "description");
  if (description) lines.push("", description);

  if (kind === "schema") {
    const version = detectVersion(result.doc) ?? detectVersion(doc);
    const type = getChildScalar(result.node, "type");
    if (type) lines.push("", `Type: \`${type}\`${version ? ` (OpenAPI ${version})` : ""}`);

    const properties = mapKeys(getChildNode(result.node, "properties"));
    if (properties.length > 0) {
      const shown = properties.slice(0, MAX_PROPERTIES_SHOWN);
      const suffix = properties.length > shown.length ? ", …" : "";
      lines.push("", `Properties: ${shown.map((p) => `\`${p}\``).join(", ")}${suffix}`);
    }
  }

  return { contents: lines.join("\n") };
}
