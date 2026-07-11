import { extname, resolve as pathResolve } from "node:path";
import { allDiagnostics, loadWorkspaceGraph, NodeFileSystem } from "@oasis/core";
import { bundle } from "@oasis/bundler";
import { parseBundleArgs } from "../args.ts";

export interface RunBundleOptions {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

export async function runBundleCommand(args: string[], io: RunBundleOptions): Promise<number> {
  const parsed = parseBundleArgs(args);
  if (!parsed.ok) {
    io.stderr(`oasis bundle: ${parsed.error}\n`);
    return 2;
  }
  const { entry, outPath, format: explicitFormat } = parsed.value;

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

  const entryDoc = graph.documents.get(absEntry);
  const parseErrors = allDiagnostics(graph).filter((d) => d.severity === "error");
  if (!entryDoc || parseErrors.length > 0) {
    for (const d of parseErrors) {
      io.stderr(`${d.range.filePath}:${d.range.start.line + 1}:${d.range.start.character + 1}  ${d.message}\n`);
    }
    io.stderr("oasis bundle: failed to parse the entry document\n");
    return 2;
  }

  const result = bundle(graph, { format });

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
