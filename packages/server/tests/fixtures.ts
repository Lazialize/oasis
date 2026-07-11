export const ENTRY_PATH = "/repo/entry.yaml";
export const SHARED_PATH = "/repo/shared.yaml";

export const ENTRY_TEXT = `openapi: 3.1.0
info:
  title: Test API
  version: "1.0.0"
paths:
  /pets:
    get:
      operationId: listPets
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Pet'
    post:
      operationId: createPet
      responses:
        '200':
          description: Created
components:
  schemas:
    Pet:
      type: object
      description: A pet
      properties:
        id:
          type: string
        name:
          type: string
    Owner:
      $ref: './shared.yaml#/components/schemas/Owner'
`;

export const SHARED_TEXT = `components:
  schemas:
    Owner:
      type: object
      description: An owner of a pet
      properties:
        name:
          type: string
`;

export function fixtureFiles(): Record<string, string> {
  return { [ENTRY_PATH]: ENTRY_TEXT, [SHARED_PATH]: SHARED_TEXT };
}
