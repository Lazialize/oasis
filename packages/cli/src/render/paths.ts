import { isAbsolute, relative, sep } from "node:path";
import type * as PathModule from "node:path";

/** The subset of `node:path` this helper relies on. Defaults to the host's `node:path`, but tests
 * can pass `path.win32` (or `path.posix`) to exercise the classification logic under a specific
 * platform's semantics regardless of the platform actually running the test. */
type PathLike = Pick<typeof PathModule, "relative" | "isAbsolute" | "sep">;

const hostPath: PathLike = { relative, isAbsolute, sep };

/**
 * A cwd-relative, forward-slashed path for `filePath` when it lives under `cwd`; otherwise the
 * absolute path unchanged. Shared by the JSON and pretty renderers (and mirrored, with a
 * `file://` URI wrapper for the outside-cwd case, by `toArtifactUri` in `sarif.ts`) so all three
 * output formats agree on which files count as "inside" the working directory.
 *
 * A file is "outside" `cwd` only when `path.relative` returns:
 * - the empty string (`filePath` IS `cwd`),
 * - exactly `..`, or a path beginning with a parent-segment (`../` or `..\`, checked against both
 *   separators regardless of host platform), or
 * - an absolute path (Windows cross-drive: `path.relative` can't express the target relatively, so
 *   it falls back to an absolute path on the other drive).
 * Everything else is inside `cwd` and rendered relative with forward slashes — in particular, a
 * real in-tree name that merely begins with `..` (e.g. `..generated`) is NOT treated as outside.
 */
export function toRelativeFilePath(filePath: string, cwd: string, pathImpl: PathLike = hostPath): string {
  const rel = pathImpl.relative(cwd, filePath);
  if (rel === "") return filePath;
  if (pathImpl.isAbsolute(rel)) return filePath;
  if (rel === ".." || rel.startsWith(`..${pathImpl.sep}`) || rel.startsWith("../") || rel.startsWith("..\\")) {
    return filePath;
  }
  return rel.split("\\").join("/");
}
