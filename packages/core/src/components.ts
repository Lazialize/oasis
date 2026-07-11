/** Every section that may appear under an OpenAPI document's `components` object
 * (`pathItems` is 3.1-only). */
export const COMPONENT_SECTIONS = [
  "schemas",
  "parameters",
  "responses",
  "requestBodies",
  "headers",
  "examples",
  "links",
  "callbacks",
  "securitySchemes",
  "pathItems",
] as const;

export type ComponentSection = (typeof COMPONENT_SECTIONS)[number];
