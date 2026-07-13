#!/usr/bin/env bun
/**
 * Copies the version of @oasis/cli into editors/vscode/package.json and
 * editors/vscode/package-lock.json.
 *
 * editors/vscode is npm-managed and lives outside the Bun workspace, so it's
 * not covered by changesets' fixed group. This script keeps its version in
 * sync after `changeset version` bumps the workspace packages. Run as the
 * second half of the root `version` script.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const rootDir = join(import.meta.dir, "..");
const cliPackagePath = join(rootDir, "packages/cli/package.json");
const vscodePackagePath = join(rootDir, "editors/vscode/package.json");
const vscodePackageLockPath = join(rootDir, "editors/vscode/package-lock.json");

const cliPackage = JSON.parse(readFileSync(cliPackagePath, "utf8"));
const version = cliPackage.version;

if (typeof version !== "string" || version.length === 0) {
  throw new Error(`Could not read a version from ${cliPackagePath}`);
}

// Update package.json
const vscodeRaw = readFileSync(vscodePackagePath, "utf8");
const vscodePackage = JSON.parse(vscodeRaw);

if (vscodePackage.version === version) {
  console.log(`editors/vscode/package.json already at ${version}`);
} else {
  vscodePackage.version = version;
  // Preserve trailing newline style of the original file.
  const trailingNewline = vscodeRaw.endsWith("\n") ? "\n" : "";
  writeFileSync(
    vscodePackagePath,
    `${JSON.stringify(vscodePackage, null, 2)}${trailingNewline}`,
  );
  console.log(`Synced editors/vscode/package.json version -> ${version}`);
}

// Update package-lock.json
const lockfileRaw = readFileSync(vscodePackageLockPath, "utf8");
const lockfile = JSON.parse(lockfileRaw);

let lockfileUpdated = false;
if (lockfile.version !== version) {
  lockfile.version = version;
  lockfileUpdated = true;
}
if (lockfile.packages?.[""]?.version !== version) {
  if (!lockfile.packages) {
    lockfile.packages = {};
  }
  if (!lockfile.packages[""] ) {
    lockfile.packages[""] = {};
  }
  lockfile.packages[""].version = version;
  lockfileUpdated = true;
}

if (lockfileUpdated) {
  // Preserve trailing newline style of the original file.
  const trailingNewline = lockfileRaw.endsWith("\n") ? "\n" : "";
  writeFileSync(
    vscodePackageLockPath,
    `${JSON.stringify(lockfile, null, 2)}${trailingNewline}`,
  );
  console.log(`Synced editors/vscode/package-lock.json version -> ${version}`);
} else {
  console.log(`editors/vscode/package-lock.json already at ${version}`);
}
