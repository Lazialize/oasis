/** Every section that may appear under an OpenAPI document's `components` object. */
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
  "mediaTypes",
] as const;

export type ComponentSection = (typeof COMPONENT_SECTIONS)[number];
