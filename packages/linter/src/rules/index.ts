import { noDuplicateKeys, noRefCycle, noUnresolvedRef } from "./core-diagnostics.ts";
import { noUnusedComponents } from "./no-unused-components.ts";
import { operationDescription } from "./operation-description.ts";
import { operationOperationId } from "./operation-operation-id.ts";
import { operationTags } from "./operation-tags.ts";
import { pathParamsDefined } from "./path-params-defined.ts";
import { structureFieldTypes } from "./structure-field-types.ts";
import { structureHttpMethods } from "./structure-http-methods.ts";
import { structureOpenapiVersion } from "./structure-openapi-version.ts";
import { structureRequiredFields } from "./structure-required-fields.ts";
import { structureSchemaNullable } from "./structure-schema-nullable.ts";
import type { Rule } from "../types.ts";

/** Every built-in rule, in a stable order used for config resolution and documentation. */
export const rules: Rule[] = [
  structureRequiredFields,
  structureOpenapiVersion,
  structureFieldTypes,
  structureHttpMethods,
  structureSchemaNullable,
  noDuplicateKeys,
  noUnresolvedRef,
  noRefCycle,
  operationOperationId,
  operationTags,
  operationDescription,
  pathParamsDefined,
  noUnusedComponents,
];

export {
  noDuplicateKeys,
  noRefCycle,
  noUnresolvedRef,
  noUnusedComponents,
  operationDescription,
  operationOperationId,
  operationTags,
  pathParamsDefined,
  structureFieldTypes,
  structureHttpMethods,
  structureOpenapiVersion,
  structureRequiredFields,
  structureSchemaNullable,
};
