import { isMap } from "yaml";
import { COMPONENT_SECTIONS, findRefs, resolveRef } from "@oasis/core";
import { childAt, keyToString } from "../util.ts";
import type { Rule } from "../types.ts";

// Unused-detection for `pathItems` (3.1-only) isn't supported yet, so it's excluded here.
export const COMPONENT_CATEGORIES = COMPONENT_SECTIONS.filter((section) => section !== "pathItems");

export const noUnusedComponents: Rule = {
  name: "no-unused-components",
  description: "Flags components that are defined but never referenced by any $ref in the workspace.",
  defaultSeverity: "warn",
  check(ctx) {
    const used = new Set<string>();
    for (const doc of ctx.documents) {
      for (const ref of findRefs(doc)) {
        const result = resolveRef(ctx.graph, doc, ref.value, ref.range);
        if (result.ok) used.add(`${result.doc.filePath}::${result.pointer}`);
      }
    }

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

          ctx.report({ doc, pointer }, `Component "${name}" in "components/${category}" is not used anywhere in the workspace.`);
        }
      }
    }
  },
};
