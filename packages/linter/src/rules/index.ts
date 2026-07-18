import { noDuplicateKeys } from "./syntax-no-duplicate-keys.ts";
import { noUnresolvedRef } from "./refs-no-unresolved.ts";
import { noRefCycle } from "./refs-no-cycle.ts";
import { exampleSchemaMatch } from "./examples-schema-match.ts";
import { namingConvention } from "./style-naming-convention.ts";
import { noDuplicatePaths } from "./paths-no-duplicates.ts";
import { noUnusedComponents } from "./components-no-unused.ts";
import { noUnusedTags } from "./tags-no-unused.ts";
import { operationDescription } from "./operation-description.ts";
import { operationOperationId } from "./operation-operation-id.ts";
import { operationSuccessResponse } from "./operation-success-response.ts";
import { operationTags } from "./operation-tags.ts";
import { pathParamsDefined } from "./paths-params-defined.ts";
import { securityDefined } from "./security-defined.ts";
import { structureCallbacks } from "./structure-callbacks.ts";
import { structureDiscriminator } from "./structure-discriminator.ts";
import { structureEncoding } from "./structure-encoding.ts";
import { structureExamples } from "./structure-examples.ts";
import { structureFieldTypes } from "./structure-field-types.ts";
import { structureHttpMethods } from "./structure-http-methods.ts";
import { structureLinks } from "./structure-links.ts";
import { structureObjectShape } from "./structure-object-shape.ts";
import { structureOpenapiVersion } from "./structure-openapi-version.ts";
import { structureRequiredFields } from "./structure-required-fields.ts";
import { structureSchemaKeywords } from "./structure-schema-keywords.ts";
import { structureSchemaNullable } from "./structure-schema-nullable.ts";
import { structureSecuritySchemes } from "./structure-security-schemes.ts";
import { structureServerVariables } from "./structure-server-variables.ts";
import { structureXml } from "./structure-xml.ts";
import { tagsDefined } from "./tags-defined.ts";
import { noTagDuplicates } from "./tags-no-duplicates.ts";
import type { Rule } from "../types.ts";

/** Every built-in rule, in a stable order used for config resolution and documentation. */
export const rules: Rule[] = [
  structureRequiredFields,
  structureOpenapiVersion,
  structureFieldTypes,
  structureHttpMethods,
  structureSchemaNullable,
  structureSchemaKeywords,
  structureSecuritySchemes,
  structureServerVariables,
  structureEncoding,
  structureXml,
  structureExamples,
  structureDiscriminator,
  structureCallbacks,
  structureLinks,
  structureObjectShape,
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
  noTagDuplicates,
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
  noTagDuplicates,
  operationDescription,
  operationOperationId,
  operationSuccessResponse,
  operationTags,
  pathParamsDefined,
  securityDefined,
  structureCallbacks,
  structureDiscriminator,
  structureEncoding,
  structureExamples,
  structureFieldTypes,
  structureHttpMethods,
  structureLinks,
  structureObjectShape,
  structureOpenapiVersion,
  structureRequiredFields,
  structureSchemaKeywords,
  structureSchemaNullable,
  structureSecuritySchemes,
  structureServerVariables,
  structureXml,
  tagsDefined,
};
