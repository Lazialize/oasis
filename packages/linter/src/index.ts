export type { LintDiagnostic, LintDiagnosticSeverity, ReportLocation, ReportOptions, Rule, RuleContext, RuleSeverity } from "./types.ts";

export type { LintOptions } from "./engine.ts";
export { lint } from "./engine.ts";

export type {
  ConfigValidationResult,
  LintConfigFile,
  LintOverride,
  LoadConfigOptions,
  LoadedConfig,
  ResolvedEntries,
  ResolvedLintConfig,
  ResolvedOverride,
  ResolvedRuleConfig,
  RuleConfigValue,
} from "./config.ts";
export {
  CONFIG_FILE_NAME,
  effectiveRuleConfig,
  expandGlobEntry,
  findConfigUpward,
  isGlobPattern,
  loadConfig,
  resolveConfig,
  resolveEntries,
  validateConfigShape,
} from "./config.ts";

export { rules } from "./rules/index.ts";

export type { HttpMethod, OperationInfo, PathItemInfo, PathItemOrigin, SchemaSite } from "./openapi-walk.ts";
export { HTTP_METHODS, iterateOperations, iteratePathItems, iterateSchemas, PATH_ITEM_NON_METHOD_KEYS } from "./openapi-walk.ts";

export type { FieldSpec, FieldType, ObjectKind, ObjectShape, ShapeViolation } from "./object-shape.ts";
export {
  allowedFieldNames,
  fieldAvailableIn,
  isExtensionKey,
  OBJECT_SHAPES,
  validateObjectShape,
} from "./object-shape.ts";

export type { ResolvedLocation } from "./util.ts";
export { childAt, isRefObject, keyToString, nodeAt, resolveMaybeRef } from "./util.ts";

export { COMPONENT_CATEGORIES } from "./rules/components-no-unused.ts";
