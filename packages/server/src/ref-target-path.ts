import { dirname, relative } from "node:path";

/** Format `toPath` as a relative `$ref`-style file reference from the directory of `fromPath`. */
export function relativeRefPath(fromPath: string, toPath: string): string {
  const rel = relative(dirname(fromPath), toPath).split(/\\/).join("/");
  if (rel.startsWith(".")) return rel;
  return `./${rel}`;
}
