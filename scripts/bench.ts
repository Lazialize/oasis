#!/usr/bin/env bun
/**
 * Benchmark harness for lint/bundle performance on multi-MB specs (v0.5 roadmap item).
 *
 * Generates two synthetic workloads deterministically (see `bench-fixtures.ts`) into a temp
 * directory, then measures wall-clock time for: parse+graph load, full lint (all rules at
 * their default severities), and bundle. Each phase runs a few warmup iterations followed by
 * several measured iterations; the reported number is the median.
 *
 * Run with: `bun run scripts/bench.ts` (or `bun run bench`).
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { NodeFileSystem, loadWorkspaceGraph } from "@oasis/core";
import type { WorkspaceGraph } from "@oasis/core";
import { lint, resolveConfig } from "@oasis/linter";
import { bundle } from "@oasis/bundler";
import { generateMultiFileWorkspace, generateSingleFileSpec } from "./bench-fixtures.ts";

const WARMUP_ITERATIONS = 2;
const MEASURED_ITERATIONS = 5;

interface PhaseResult {
  label: string;
  medianMs: number;
  samples: number[];
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2 : (sorted[mid] as number);
}

async function timePhase(label: string, fn: () => Promise<void> | void): Promise<PhaseResult> {
  for (let i = 0; i < WARMUP_ITERATIONS; i++) await fn();

  const samples: number[] = [];
  for (let i = 0; i < MEASURED_ITERATIONS; i++) {
    const start = performance.now();
    await fn();
    samples.push(performance.now() - start);
  }
  return { label, medianMs: median(samples), samples };
}

/**
 * Like `timePhase`, but rebuilds the input from scratch before every iteration (via `setup`) and
 * only times `fn`. Some phases (lint) memoize per-input-object work internally, so measuring
 * `fn` against the *same* long-lived object across iterations would understate real-world cost:
 * a one-shot CLI invocation always lints a freshly loaded graph, never a warm one.
 */
async function timePhaseFresh<T>(label: string, setup: () => Promise<T> | T, fn: (input: T) => void): Promise<PhaseResult> {
  for (let i = 0; i < WARMUP_ITERATIONS; i++) fn(await setup());

  const samples: number[] = [];
  for (let i = 0; i < MEASURED_ITERATIONS; i++) {
    const input = await setup();
    const start = performance.now();
    fn(input);
    samples.push(performance.now() - start);
  }
  return { label, medianMs: median(samples), samples };
}

function formatMs(ms: number): string {
  return `${ms.toFixed(1)}ms`;
}

function printTable(rows: { workload: string; phase: string; medianMs: number }[]): void {
  const headers = ["Workload", "Phase", "Median"];
  const table = rows.map((r) => [r.workload, r.phase, formatMs(r.medianMs)]);
  const widths = headers.map((h, i) => Math.max(h.length, ...table.map((r) => (r[i] as string).length)));

  const printRow = (cells: string[]) => console.log(cells.map((c, i) => c.padEnd(widths[i] as number)).join("  "));
  printRow(headers);
  printRow(widths.map((w) => "-".repeat(w)));
  for (const row of table) printRow(row);
}

async function benchSingleFile(tempRoot: string): Promise<{ workload: string; phase: string; medianMs: number }[]> {
  const params = { seed: 42, pathCount: 550, schemaCount: 900 };
  const spec = generateSingleFileSpec(params);
  const sizeMb = (Buffer.byteLength(spec, "utf-8") / (1024 * 1024)).toFixed(2);
  console.log(
    `\nSingle-file workload: ~${sizeMb} MB YAML, ${params.pathCount} paths (5 ops each), ${params.schemaCount} component schemas`,
  );

  const workspaceDir = join(tempRoot, "single");
  mkdirSync(workspaceDir, { recursive: true });
  const entryPath = join(workspaceDir, "openapi.yaml");
  writeFileSync(entryPath, spec, "utf-8");
  const fs = new NodeFileSystem();

  let graph: WorkspaceGraph | undefined;
  const loadResult = await timePhase("parse+graph load", async () => {
    graph = await loadWorkspaceGraph(fs, entryPath);
  });

  // Lint memoizes traversal work per graph object internally, so each measured iteration gets its
  // own freshly loaded graph -- matching a real one-shot `oasis lint` invocation, which never
  // reuses a graph across lint() calls.
  const config = resolveConfig(undefined);
  const lintResult = await timePhaseFresh(
    "full lint",
    () => loadWorkspaceGraph(fs, entryPath),
    (g) => {
      lint(g, config);
    },
  );

  const bundleResult = await timePhase("bundle", () => {
    bundle(graph as WorkspaceGraph);
  });

  return [
    { workload: "single-file", phase: loadResult.label, medianMs: loadResult.medianMs },
    { workload: "single-file", phase: lintResult.label, medianMs: lintResult.medianMs },
    { workload: "single-file", phase: bundleResult.label, medianMs: bundleResult.medianMs },
  ];
}

async function benchMultiFile(tempRoot: string): Promise<{ workload: string; phase: string; medianMs: number }[]> {
  const files = generateMultiFileWorkspace({ seed: 7, pathFileCount: 80, schemaFileCount: 50, schemasPerFile: 6 });
  const workspaceDir = join(tempRoot, "multi");
  for (const file of files) {
    const abs = join(workspaceDir, file.path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, file.content, "utf-8");
  }
  console.log(`\nMulti-file workload: ${files.length} files (${files.length - 1} $ref-linked) under ${workspaceDir}`);

  const entryPath = join(workspaceDir, "openapi.yaml");
  const fs = new NodeFileSystem();

  let graph: WorkspaceGraph | undefined;
  const loadResult = await timePhase("parse+graph load", async () => {
    graph = await loadWorkspaceGraph(fs, entryPath);
  });

  const config = resolveConfig(undefined);
  const lintResult = await timePhaseFresh(
    "full lint",
    () => loadWorkspaceGraph(fs, entryPath),
    (g) => {
      lint(g, config);
    },
  );

  const bundleResult = await timePhase("bundle", () => {
    bundle(graph as WorkspaceGraph);
  });

  return [
    { workload: "multi-file", phase: loadResult.label, medianMs: loadResult.medianMs },
    { workload: "multi-file", phase: lintResult.label, medianMs: lintResult.medianMs },
    { workload: "multi-file", phase: bundleResult.label, medianMs: bundleResult.medianMs },
  ];
}

async function main(): Promise<void> {
  const tempRoot = mkdtempSync(join(tmpdir(), "oasis-bench-"));
  try {
    const rows = [...(await benchSingleFile(tempRoot)), ...(await benchMultiFile(tempRoot))];
    console.log(`\n${WARMUP_ITERATIONS} warmup + ${MEASURED_ITERATIONS} measured iterations per phase, median reported.\n`);
    printTable(rows);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
