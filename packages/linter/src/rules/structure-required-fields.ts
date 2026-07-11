import { isMap, isScalar } from "yaml";
import { childAt } from "../util.ts";
import type { Rule } from "../types.ts";

export const structureRequiredFields: Rule = {
  name: "structure/required-fields",
  description: 'Requires "openapi", "info" (with "title"/"version"), and "paths" (or 3.1 alternatives) to be present.',
  defaultSeverity: "error",
  check(ctx) {
    const root = ctx.entryDoc.yamlDoc.contents;
    if (!root || !isMap(root)) {
      ctx.report({ doc: ctx.entryDoc, pointer: "" }, "Document root must be an object.");
      return;
    }

    if (!childAt(root, "openapi")) {
      ctx.report({ doc: ctx.entryDoc, node: root }, 'Missing required field "openapi".');
    }

    const infoNode = childAt(root, "info");
    if (!infoNode) {
      ctx.report({ doc: ctx.entryDoc, node: root }, 'Missing required field "info".');
    } else if (!isMap(infoNode)) {
      ctx.report({ doc: ctx.entryDoc, node: infoNode }, '"info" must be an object.');
    } else {
      const titleNode = childAt(infoNode, "title");
      if (!titleNode || !isScalar(titleNode) || typeof titleNode.value !== "string" || titleNode.value === "") {
        ctx.report({ doc: ctx.entryDoc, node: infoNode }, 'Missing required field "info.title".');
      }
      const versionNode = childAt(infoNode, "version");
      if (!versionNode || !isScalar(versionNode) || typeof versionNode.value !== "string" || versionNode.value === "") {
        ctx.report({ doc: ctx.entryDoc, node: infoNode }, 'Missing required field "info.version".');
      }
    }

    const hasPaths = !!childAt(root, "paths");
    if (ctx.version === "3.1") {
      const hasWebhooks = !!childAt(root, "webhooks");
      const hasComponents = !!childAt(root, "components");
      if (!hasPaths && !hasWebhooks && !hasComponents) {
        ctx.report(
          { doc: ctx.entryDoc, node: root },
          'Document must define at least one of "paths", "webhooks", or "components".',
        );
      }
    } else if (!hasPaths) {
      ctx.report({ doc: ctx.entryDoc, node: root }, 'Missing required field "paths".');
    }
  },
};
