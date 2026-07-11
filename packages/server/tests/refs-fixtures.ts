/** Fixtures for find-references / rename tests: a small project-mode workspace with an entry
 * document, a Path Item fragment file (no `openapi` key), and two components — `Pet` (referenced
 * from the fragment twice and from within the entry itself) and `Owner` (referenced nowhere, used
 * for collision tests). */

export const ROOT = "/proj";
export const CONFIG_PATH = `${ROOT}/oasis.config.jsonc`;
export const ENTRY_PATH = `${ROOT}/openapi.yaml`;
export const FRAGMENT_PATH = `${ROOT}/paths/pets.yaml`;

export const CONFIG_TEXT = `{ "entries": ["openapi.yaml"] }`;

export const ENTRY_TEXT = `openapi: 3.1.0
info:
  title: Test API
  version: "1.0.0"
paths:
  /pets:
    $ref: './paths/pets.yaml'
components:
  schemas:
    Pet:
      type: object
      description: A pet
      properties:
        id:
          type: string
    Owner:
      type: object
      description: An owner of a pet
      properties:
        pet:
          $ref: '#/components/schemas/Pet'
`;

export const FRAGMENT_TEXT = `get:
  operationId: listPets
  tags: [pets]
  description: List pets.
  responses:
    '200':
      description: OK
      content:
        application/json:
          schema:
            $ref: '../openapi.yaml#/components/schemas/Pet'
post:
  operationId: createPet
  tags: [pets]
  description: Create a pet.
  requestBody:
    content:
      application/json:
        schema:
          $ref: '../openapi.yaml#/components/schemas/Pet'
  responses:
    '201':
      description: Created
`;

export function refsFixtureFiles(): Record<string, string> {
  return {
    [CONFIG_PATH]: CONFIG_TEXT,
    [ENTRY_PATH]: ENTRY_TEXT,
    [FRAGMENT_PATH]: FRAGMENT_TEXT,
  };
}
