import { detectVersion } from "@oasis/core";
import type { Position } from "@oasis/core";
import { OBJECT_SHAPES } from "@oasis/linter";
import { classifyPointer } from "../keywords.ts";
import { resolveRefAtPosition } from "../refs.ts";
import { getChildNode, getChildScalar, mapKeys } from "../yaml-helpers.ts";
import { resolveDocContext } from "../workspace.ts";
import type { ServerContext } from "../workspace.ts";

export interface HoverParams {
  path: string;
  position: Position;
}

export interface HoverResult {
  contents: string;
}

const MAX_PROPERTIES_SHOWN = 10;

/** Cursor on a `$ref` -> a short summary of the resolved target. */
export async function getHover(ctx: ServerContext, params: HoverParams): Promise<HoverResult | undefined> {
  const docCtx = await resolveDocContext(ctx, params.path);
  if (!docCtx) return undefined;

  const result = resolveRefAtPosition(docCtx.graph, docCtx.doc, params.position);
  if (!result) return undefined;

  const kind = classifyPointer(result.pointer) ?? "schema";
  const lines: string[] = [`**${OBJECT_SHAPES[kind].name}** \`${result.pointer || "/"}\``];

  const description = getChildScalar(result.node, "description");
  if (description) lines.push("", description);

  if (kind === "schema") {
    const version = detectVersion(result.doc) ?? detectVersion(docCtx.doc);
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
