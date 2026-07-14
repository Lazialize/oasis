import type { Diagnostic as LspDiagnostic } from "vscode-languageserver";
import { getDiagnosticsByFile } from "./diagnostics.ts";
import type { ServerContext } from "./workspace.ts";

/**
 * Diagnostics publishing bookkeeping for the LSP server, extracted from `connection.ts` so it can
 * be unit-tested against an in-memory `ServerContext` and a capturing `publish` callback.
 *
 * LSP `publishDiagnostics` is keyed only by URI: whatever a server sends for a URI *replaces*
 * everything previously shown for it. A file reachable from more than one configured project entry
 * (a shared components file, say) gets diagnostics from *each* entry's lint run — possibly
 * different ones per entry, since each entry can be governed by a different config. Publishing one
 * entry's results directly would therefore clobber the other's, make the outcome depend on
 * entry/validation completion order, and let clearing one entry erase another's still-valid
 * findings.
 *
 * So the runner keeps diagnostics per `entry -> file` and always publishes the merged, deduplicated
 * union across entries for each affected file. Removing one entry's contribution (`clearEntry`)
 * republishes the merge of whatever the remaining entries still report.
 */
export interface ValidationRunnerOptions {
  /** Publish the full merged diagnostics set for a file (replaces anything shown for it). */
  publish: (filePath: string, diagnostics: LspDiagnostic[]) => void;
}

export interface ValidationRunner {
  /**
   * Lint `entryPath`'s graph and publish the merged diagnostics for every affected file.
   *
   * Guarded against stale completions (issue #49): each call is stamped with a fresh per-entry
   * generation, and a call that finds itself superseded by the time its (async, possibly slow)
   * lint finishes discards its result instead of publishing — so an older run that completes
   * *after* a newer edit's run can never overwrite the newer diagnostics.
   */
  validate(entryPath: string): Promise<void>;
  /**
   * Drop `entryPath`'s stored contribution and republish the merged remainder for every file it
   * had published to, so only *its* diagnostics disappear (a sibling entry's survive). Also
   * supersedes any outstanding `validate` for the entry.
   */
  clearEntry(entryPath: string): void;
  /**
   * Supersede any outstanding `validate` for `entryPath` without touching what's published — for
   * events (close, project reload) after which in-flight results must not land, but where the
   * caller decides separately what happens to the published diagnostics.
   */
  invalidateEntry(entryPath: string): void;
  /** Publish the current merged set (possibly empty) for a single file, unconditionally. */
  republishFile(filePath: string): void;
}

export function createValidationRunner(ctx: ServerContext, options: ValidationRunnerOptions): ValidationRunner {
  const { publish } = options;

  /** entryPath -> (filePath -> that entry's diagnostics for the file). */
  const publishedByEntry = new Map<string, Map<string, LspDiagnostic[]>>();
  /** Per-entry validation generation; a `validate` whose generation is no longer current when its
   * lint completes discards its result (see `ValidationRunner.validate`). */
  const generations = new Map<string, number>();

  function bumpGeneration(entryPath: string): number {
    const generation = (generations.get(entryPath) ?? 0) + 1;
    generations.set(entryPath, generation);
    return generation;
  }

  function mergedForFile(filePath: string): LspDiagnostic[] {
    const merged: LspDiagnostic[] = [];
    // A file shared by two entries linted under the *same* config yields the same diagnostics from
    // both graphs; dedupe so the user doesn't see every finding doubled.
    const seen = new Set<string>();
    for (const byFile of publishedByEntry.values()) {
      for (const diagnostic of byFile.get(filePath) ?? []) {
        const key = JSON.stringify([diagnostic.code, diagnostic.severity, diagnostic.range, diagnostic.message]);
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(diagnostic);
      }
    }
    return merged;
  }

  function republish(files: Iterable<string>): void {
    for (const file of files) publish(file, mergedForFile(file));
  }

  async function validate(entryPath: string): Promise<void> {
    const generation = bumpGeneration(entryPath);
    const byFile = await getDiagnosticsByFile(ctx, entryPath);
    // Superseded while linting (a newer validate started, or the entry was cleared/invalidated):
    // this result reflects content that is no longer current — drop it.
    if (generations.get(entryPath) !== generation) return;
    const prev = publishedByEntry.get(entryPath);
    publishedByEntry.set(entryPath, byFile);
    // Republish every file the new result touches plus every file the previous one did (a file
    // that dropped out of the graph must be republished so this entry's stale contribution clears).
    const affected = new Set<string>(byFile.keys());
    for (const file of prev?.keys() ?? []) affected.add(file);
    republish(affected);
  }

  function clearEntry(entryPath: string): void {
    bumpGeneration(entryPath); // an in-flight validate must not resurrect what we're clearing
    const prev = publishedByEntry.get(entryPath);
    if (!prev) return;
    publishedByEntry.delete(entryPath);
    republish(prev.keys());
  }

  return {
    validate,
    clearEntry,
    invalidateEntry: (entryPath) => void bumpGeneration(entryPath),
    republishFile: (filePath) => republish([filePath]),
  };
}
