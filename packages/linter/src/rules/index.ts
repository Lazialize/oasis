import { noDuplicateKeys, noRefCycle, noUnresolvedRef } from "./core-diagnostics.ts";
import { exampleSchemaMatch } from "./example-schema-match.ts";
import { namingConvention } from "./naming-convention.ts";
import { noDuplicatePaths } from "./no-duplicate-paths.ts";
import { noUnusedComponents } from "./no-unused-components.ts";
import { noUnusedTags } from "./no-unused-tags.ts";
import { operationDescription } from "./operation-description.ts";
import { operationOperationId } from "./operation-operation-id.ts";
import { operationSuccessResponse } from "./operation-success-response.ts";
import { operationTags } from "./operation-tags.ts";
import { pathParamsDefined } from "./path-params-defined.ts";
import { securityDefined } from "./security-defined.ts";
import { structureEncoding } from "./structure-encoding.ts";
import { structureExamples } from "./structure-examples.ts";
import { structureFieldTypes } from "./structure-field-types.ts";
import { structureHttpMethods } from "./structure-http-methods.ts";
import { structureOpenapiVersion } from "./structure-openapi-version.ts";
import { structureRequiredFields } from "./structure-required-fields.ts";
import { structureSchemaNullable } from "./structure-schema-nullable.ts";
import { structureSecuritySchemes } from "./structure-security-schemes.ts";
import { structureServerVariables } from "./structure-server-variables.ts";
import { structureXml } from "./structure-xml.ts";
import { tagsDefined } from "./tags-defined.ts";
import type { Rule } from "../types.ts";

/** Every built-in rule, in a stable order used for config resolution and documentation. */
export const rules: Rule[] = [
  structureRequiredFields,
  structureOpenapiVersion,
  structureFieldTypes,
  structureHttpMethods,
  structureSchemaNullable,
  structureSecuritySchemes,
  structureServerVariables,
  structureEncoding,
  structureXml,
  structureExamples,
  noDuplicateKeys,
  noUnresolvedRef,
  noRefCycle,
  operationOperationId,
  operationTags,
  operationDescription,
  operationSuccessResponse,
  pathParamsDefined,
  noUnusedComponents,
  noDuplicatePaths,
  securityDefined,
  tagsDefined,
  noUnusedTags,
  namingConvention,
  exampleSchemaMatch,
];

export {
  exampleSchemaMatch,
  namingConvention,
  noDuplicateKeys,
  noDuplicatePaths,
  noRefCycle,
  noUnresolvedRef,
  noUnusedComponents,
  noUnusedTags,
  operationDescription,
  operationOperationId,
  operationSuccessResponse,
  operationTags,
  pathParamsDefined,
  securityDefined,
  structureEncoding,
  structureExamples,
  structureFieldTypes,
  structureHttpMethods,
  structureOpenapiVersion,
  structureRequiredFields,
  structureSchemaNullable,
  structureSecuritySchemes,
  structureServerVariables,
  structureXml,
  tagsDefined,
};
