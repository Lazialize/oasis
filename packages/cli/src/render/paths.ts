import { relative } from "node:path";

/**
 * A cwd-relative, forward-slashed path for `filePath` when it lives under `cwd`; otherwise the
 * absolute path unchanged. Shared by the JSON and pretty renderers (and mirrored, with a
 * `file://` URI wrapper for the outside-cwd case, by `toArtifactUri` in `sarif.ts`) so all three
 * output formats agree on which files count as "inside" the working directory.
 */
export function toRelativeFilePath(filePath: string, cwd: string): string {
  const rel = relative(cwd, filePath);
  if (rel.startsWith("..") || rel === "") return filePath;
  return rel.split("\\").join("/");
}
