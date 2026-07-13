import { extname, resolve as pathResolve } from "node:path";
import { loadWorkspaceGraph, NodeFileSystem } from "@oasis/core";
import { bundle } from "@oasis/bundler";
import { hasHelpFlag, parseBundleArgs } from "../args.ts";

export interface RunBundleOptions {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

const BUNDLE_HELP = `oasis bundle <entry> [-o|--out path] [--format yaml|json] [--dereference]

Bundle a multi-file OpenAPI document into a single self-contained document, lifting external
\`$ref\`s into \`components/*\` (or fully inlining them with --dereference).

Options:
  -o, --out path       Write the bundled document here instead of stdout
  --format yaml|json    Output format (default: inferred from --out extension, else yaml)
  --dereference         Fully inline every $ref instead of lifting external refs
  -h, --help            Show this help message
`;

export async function runBundleCommand(args: string[], io: RunBundleOptions): Promise<number> {
  if (hasHelpFlag(args)) {
    io.stdout(BUNDLE_HELP);
    return 0;
  }
  const parsed = parseBundleArgs(args);
  if (!parsed.ok) {
    io.stderr(`oasis bundle: ${parsed.error}\n`);
    return 2;
  }
  const { entry, outPath, format: explicitFormat, dereference } = parsed.value;

  const format = explicitFormat ?? (outPath && extname(outPath).toLowerCase() === ".json" ? "json" : "yaml");

  const fs = new NodeFileSystem();
  const absEntry = pathResolve(process.cwd(), entry);

  let graph: Awaited<ReturnType<typeof loadWorkspaceGraph>>;
  try {
    graph = await loadWorkspaceGraph(fs, absEntry);
  } catch (err) {
    io.stderr(`oasis bundle: ${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }

  // Separate genuine parse/syntax failures (per-document diagnostics) from graph-load diagnostics
  // (unresolved external `$ref` targets, ref cycles). An unresolved external target is NOT a fatal
  // error here: the bundler preserves the `$ref` verbatim and returns a warning, matching its API,
  // so only an entry that failed to load or a real syntax error aborts the command (#30).
  const entryDoc = graph.documents.get(absEntry);
  const parseErrors = [...graph.documents.values()].flatMap((d) => d.diagnostics).filter((d) => d.severity === "error");
  if (!entryDoc || parseErrors.length > 0) {
    for (const d of parseErrors) {
      io.stderr(`${d.range.filePath}:${d.range.start.line + 1}:${d.range.start.character + 1}  ${d.message}\n`);
    }
    io.stderr("oasis bundle: failed to parse the entry document\n");
    return 2;
  }

  const result = bundle(graph, { format, dereference });

  for (const d of result.diagnostics) {
    io.stderr(
      `warning: ${d.message} (${d.range.filePath}:${d.range.start.line + 1}:${d.range.start.character + 1})\n`,
    );
  }

  if (outPath) {
    try {
      await Bun.write(pathResolve(process.cwd(), outPath), result.output);
    } catch (err) {
      io.stderr(`oasis bundle: ${err instanceof Error ? err.message : String(err)}\n`);
      return 2;
    }
  } else {
    io.stdout(result.output);
  }

  return 0;
}
