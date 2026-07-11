// Mirrors the regexes in editors/vscode/src/extension.ts. The extension's client-side guard only
// applies when no oasis.config.jsonc is present in the workspace; once project mode is active the
// client syncs every yaml/json/jsonc document and the server decides membership itself (see
// findOwningEntry in workspace.ts). Files that are neither a project member nor look like an
// OpenAPI document (no top-level `openapi:`/`"openapi"` key) are silently ignored here so they
// don't get spuriously linted as a broken standalone entry.
const OPENAPI_YAML_KEY = /^\s*(['"]?)openapi\1\s*:/m;
const OPENAPI_JSON_KEY = /"openapi"\s*:/;

/** Whether `text` looks like it declares a top-level `openapi:`/`"openapi"` key. */
export function looksLikeOpenApi(text: string): boolean {
  return OPENAPI_YAML_KEY.test(text) || OPENAPI_JSON_KEY.test(text);
}
