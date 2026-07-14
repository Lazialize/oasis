import { LineCounter, isMap, isNode, parseDocument as yamlParseDocument } from "yaml";
import type { Document as YamlDocument } from "yaml";
import type { Diagnostic } from "./types.ts";
import { rangeFromOffsets, zeroRange } from "./position.ts";
import { keyToString, registerNodeDocument, walkNodes } from "./walk.ts";

export interface OasisDocument {
  /** Absolute path (or synthetic URI) identifying this document. */
  filePath: string;
  /** Raw source text as parsed. */
  text: string;
  /** The composed yaml Document, retaining AST nodes with source ranges. */
  yamlDoc: YamlDocument.Parsed;
  lineCounter: LineCounter;
  /** Parse-time diagnostics: YAML syntax errors/warnings and duplicate keys. */
  diagnostics: Diagnostic[];
}

/**
 * Parse YAML (or JSON, which is a valid YAML subset) source text, retaining a
 * position-preserving AST. Never throws: syntax errors are reported as diagnostics.
 */
export function parseDocument(text: string, filePath: string): OasisDocument {
  // Strip a leading BOM before parsing: editors (and LSP clients) treat it as encoding metadata,
  // not document content, so keeping it in the offset space would shift every first-line column
  // by one relative to what the user sees. `text` is stored stripped for the same reason — all
  // stored offsets index into it.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const lineCounter = new LineCounter();
  const yamlDoc = yamlParseDocument(text, {
    lineCounter,
    keepSourceTokens: true,
    // We detect duplicate keys ourselves below, with our own diagnostic shape,
    // rather than relying on yaml's built-in (non-throwing) composition error.
    uniqueKeys: false,
  });

  const diagnostics: Diagnostic[] = [];
  if (isNode(yamlDoc.contents)) registerNodeDocument(yamlDoc.contents, yamlDoc);

  for (const err of yamlDoc.errors) {
    diagnostics.push({
      message: err.message,
      severity: "error",
      source: "yaml",
      range: err.pos
        ? rangeFromOffsets(filePath, lineCounter, err.pos[0], err.pos[1])
        : zeroRange(filePath),
    });
  }
  for (const warn of yamlDoc.warnings) {
    diagnostics.push({
      message: warn.message,
      severity: "warning",
      source: "yaml",
      range: warn.pos
        ? rangeFromOffsets(filePath, lineCounter, warn.pos[0], warn.pos[1])
        : zeroRange(filePath),
    });
  }

  diagnostics.push(...detectDuplicateKeys(yamlDoc, filePath, lineCounter));

  return { filePath, text, yamlDoc, lineCounter, diagnostics };
}

function detectDuplicateKeys(yamlDoc: YamlDocument.Parsed, filePath: string, lineCounter: LineCounter): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const root = yamlDoc.contents;
  if (!isNode(root)) return diagnostics;

  walkNodes(root, yamlDoc, (node) => {
    if (!isMap(node)) return;
    const seen = new Set<string>();
    for (const pair of node.items) {
      const keyStr = keyToString(pair.key);
      if (seen.has(keyStr)) {
        const keyNode = pair.key;
        const range = isNode(keyNode) && keyNode.range
          ? rangeFromOffsets(filePath, lineCounter, keyNode.range[0], keyNode.range[1])
          : zeroRange(filePath);
        diagnostics.push({
          message: `Duplicate key "${keyStr}"`,
          severity: "error",
          code: "no-duplicate-keys",
          source: "core",
          range,
        });
      } else {
        seen.add(keyStr);
      }
    }
  });

  return diagnostics;
}
