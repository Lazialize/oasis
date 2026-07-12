#!/usr/bin/env bun
/**
 * Generates the Homebrew formula (Formula/oasis.rb) for the
 * `Lazialize/homebrew-oasis` tap from the template in this directory.
 *
 * Pure generation logic lives in `generateFormula` / `parseShasums` so it's
 * unit-testable without touching git or the network. The CLI entry point
 * (used by .github/workflows/release.yml) reads a version and a
 * SHASUMS256.txt produced by the release job and writes the formula to
 * stdout or a file.
 *
 * Usage:
 *   bun run scripts/homebrew/generate-formula.ts \
 *     --version 1.2.3 \
 *     --shasums release/SHASUMS256.txt \
 *     [--out Formula/oasis.rb]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const REQUIRED_ASSETS = {
  darwinArm64: "oasis-darwin-arm64.tar.gz",
  darwinX64: "oasis-darwin-x64.tar.gz",
  linuxArm64: "oasis-linux-arm64.tar.gz",
  linuxX64: "oasis-linux-x64.tar.gz",
} as const;

export type AssetShasums = Record<keyof typeof REQUIRED_ASSETS, string>;

/**
 * Parses `shasum -a 256 *` output (lines of `<sha256>  <filename>`) into a
 * filename -> sha256 map.
 */
export function parseShasums(contents: string): Map<string, string> {
  const shasums = new Map<string, string>();
  for (const rawLine of contents.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    // shasum output separates the hash and filename with two spaces
    // (binary mode) or " *" (text mode); accept either.
    const match = line.match(/^([0-9a-fA-F]{64})\s+\*?(.+)$/);
    if (!match) continue;
    const [, hash, filename] = match;
    if (!hash || !filename) continue;
    shasums.set(filename.trim(), hash.toLowerCase());
  }
  return shasums;
}

/**
 * Picks the four release assets the formula needs out of a full shasums map,
 * throwing a clear error if any are missing.
 */
export function selectAssetShasums(
  shasums: Map<string, string>,
): AssetShasums {
  const result = {} as AssetShasums;
  const missing: string[] = [];
  for (const [key, filename] of Object.entries(REQUIRED_ASSETS) as [
    keyof typeof REQUIRED_ASSETS,
    string,
  ][]) {
    const sha256 = shasums.get(filename);
    if (!sha256) {
      missing.push(filename);
      continue;
    }
    result[key] = sha256;
  }
  if (missing.length > 0) {
    throw new Error(
      `Missing sha256 for required release asset(s): ${missing.join(", ")}`,
    );
  }
  return result;
}

export interface GenerateFormulaOptions {
  /** Release version, without the leading "v" (e.g. "1.2.3"). */
  version: string;
  shasums: AssetShasums;
  template: string;
}

/**
 * Fills the `oasis.rb.tmpl` template's `{{PLACEHOLDER}}` tokens with the
 * given version and per-asset sha256 values.
 */
export function generateFormula(options: GenerateFormulaOptions): string {
  const { version, shasums, template } = options;
  if (version.startsWith("v")) {
    throw new Error(
      `version must not include the leading "v" (got "${version}")`,
    );
  }

  const replacements: Record<string, string> = {
    VERSION: version,
    SHA256_DARWIN_ARM64: shasums.darwinArm64,
    SHA256_DARWIN_X64: shasums.darwinX64,
    SHA256_LINUX_ARM64: shasums.linuxArm64,
    SHA256_LINUX_X64: shasums.linuxX64,
  };

  let formula = template;
  for (const [token, value] of Object.entries(replacements)) {
    formula = formula.replaceAll(`{{${token}}}`, value);
  }

  const unresolved = formula.match(/\{\{[A-Z0-9_]+\}\}/g);
  if (unresolved) {
    throw new Error(
      `Formula template has unresolved placeholder(s): ${unresolved.join(", ")}`,
    );
  }

  return formula;
}

function parseArgs(argv: string[]): {
  version: string;
  shasumsPath: string;
  outPath: string | undefined;
} {
  let version: string | undefined;
  let shasumsPath: string | undefined;
  let outPath: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--version") {
      version = argv[++i];
    } else if (arg === "--shasums") {
      shasumsPath = argv[++i];
    } else if (arg === "--out") {
      outPath = argv[++i];
    }
  }

  if (!version) throw new Error("--version is required");
  if (!shasumsPath) throw new Error("--shasums <path to SHASUMS256.txt> is required");

  return { version: version.replace(/^v/, ""), shasumsPath, outPath };
}

async function main() {
  const { version, shasumsPath, outPath } = parseArgs(process.argv.slice(2));

  const shasumsContents = readFileSync(shasumsPath, "utf8");
  const shasums = selectAssetShasums(parseShasums(shasumsContents));

  const templatePath = join(import.meta.dir, "oasis.rb.tmpl");
  const template = readFileSync(templatePath, "utf8");

  const formula = generateFormula({ version, shasums, template });

  if (outPath) {
    writeFileSync(outPath, formula);
    console.log(`Wrote formula for oasis ${version} -> ${outPath}`);
  } else {
    process.stdout.write(formula);
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
