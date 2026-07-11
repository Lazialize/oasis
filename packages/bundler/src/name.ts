import { basename, extname } from "node:path";

/** Component names in OpenAPI must match ^[a-zA-Z0-9._-]+$; sanitize anything else. */
export function sanitizeName(candidate: string): string {
  const cleaned = candidate.replace(/[^a-zA-Z0-9._-]/g, "_");
  return cleaned === "" ? "component" : cleaned;
}

/** The filename stem (no directory, no extension) used as the candidate name for whole-file refs. */
export function fileStem(filePath: string): string {
  const base = basename(filePath);
  const ext = extname(base);
  return sanitizeName(ext ? base.slice(0, -ext.length) : base);
}

/**
 * Pick a unique name for `candidate` within `used` (a set of already-assigned names in the same
 * component section), deterministically disambiguating conflicts with a numeric suffix.
 */
export function uniqueName(candidate: string, used: Set<string>): string {
  if (!used.has(candidate)) {
    used.add(candidate);
    return candidate;
  }
  let i = 2;
  while (used.has(`${candidate}_${i}`)) i++;
  const name = `${candidate}_${i}`;
  used.add(name);
  return name;
}
