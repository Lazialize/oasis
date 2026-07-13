/** Fixtures for the multi-entry-workspace tests: an `oasis.config.jsonc` with two entries
 * (`a.yaml`, `b.yaml`) that both `$ref` a component (`Pet`) defined in a third, shared file. The
 * shared file therefore belongs to *both* entry graphs — the case where rename / find-references
 * must union every reaching graph, and `components/no-unused` must count usage from a sibling
 * entry. */

export const ROOT = "/multi";
export const CONFIG_PATH = `${ROOT}/oasis.config.jsonc`;
export const ENTRY_A_PATH = `${ROOT}/a.yaml`;
export const ENTRY_B_PATH = `${ROOT}/b.yaml`;
export const SHARED_PATH = `${ROOT}/shared.yaml`;

export const CONFIG_TEXT = `{ "entries": ["a.yaml", "b.yaml"] }`;

/** Both `a.yaml` and `b.yaml` reference `Pet`; used by the rename / find-references tests. */
export const SHARED_TEXT = `components:
  schemas:
    Pet:
      type: object
      description: A pet
      properties:
        id:
          type: string
`;

function entryText(title: string, pathKey: string, opId: string, refPointer: string): string {
  return `openapi: 3.1.0
info:
  title: ${title}
  version: "1.0.0"
paths:
  ${pathKey}:
    get:
      operationId: ${opId}
      tags: [${title.toLowerCase()}]
      description: ${title}.
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: './shared.yaml#/components/schemas/${refPointer}'
`;
}

export const ENTRY_A_TEXT = entryText("A", "/a", "aGet", "Pet");
export const ENTRY_B_TEXT = entryText("B", "/b", "bGet", "Pet");

export function multiEntryFiles(): Record<string, string> {
  return {
    [CONFIG_PATH]: CONFIG_TEXT,
    [ENTRY_A_PATH]: ENTRY_A_TEXT,
    [ENTRY_B_PATH]: ENTRY_B_TEXT,
    [SHARED_PATH]: SHARED_TEXT,
  };
}

// --- A separate shape where `Pet` is used ONLY by the sibling entry `b.yaml` ---------------------
// `a.yaml` references `Common` (so `shared.yaml` is in entry A's graph), but only `b.yaml`
// references `Pet`. Linting A's graph must not report `Pet` as unused.

export const SHARED_TWO_COMPONENTS_TEXT = `components:
  schemas:
    Common:
      type: object
      description: Common
      properties:
        id:
          type: string
    Pet:
      type: object
      description: A pet
      properties:
        name:
          type: string
`;

export function siblingUsageFiles(): Record<string, string> {
  return {
    [CONFIG_PATH]: CONFIG_TEXT,
    [ENTRY_A_PATH]: entryText("A", "/a", "aGet", "Common"),
    [ENTRY_B_PATH]: entryText("B", "/b", "bGet", "Pet"),
    [SHARED_PATH]: SHARED_TWO_COMPONENTS_TEXT,
  };
}
