/**
 * schemind — language-agnostic API response shape intelligence.
 *
 * Public entry point for the TypeScript core. Phase 0 surface: type system,
 * shape extractor, diff engine, snapshot store and the console reporter.
 *
 * @see ARCHITECTURE.md
 */

/* Core type system */
export type {
  AdapterMeta,
  ArrayNode,
  ChangeType,
  DriftChange,
  DriftReport,
  ObjectNode,
  ObservedResponse,
  Reporter,
  ScalarNode,
  ScalarType,
  Severity,
  ShapeKind,
  ShapeNode,
  UnionNode,
} from './types.js'

/* Severity rules */
export {
  highestSeverity,
  maxSeverity,
  SEVERITY_BY_CHANGE_TYPE,
  SEVERITY_RANK,
  severityOf,
} from './severity.js'

/* Shape utilities + constructors */
export {
  array,
  isArray,
  isNull,
  isNullable,
  isObject,
  isScalar,
  isUnion,
  isUnknown,
  object,
  scalar,
  shapesEqual,
  stringifyShape,
  union,
  UNKNOWN,
  unionNode,
  withoutNull,
} from './shape.js'

/* Shape extraction */
export { extractShape, type ExtractOptions } from './extractor.js'

/* Path-based field suppression */
export { prunePaths } from './prune.js'

/* Diff engine */
export { diffReport, diffShapes } from './diff.js'

/* Endpoint normalization */
export {
  DEFAULT_PARAM_PATTERNS,
  normalizeEndpoint,
  normalizePath,
  pathOf,
  type ParamPattern,
} from './normalize.js'

/* Observe engine — the full extract → snapshot → diff → report pipeline */
export {
  createSchemind,
  Schemind,
  type ObserveInput,
  type ObserveResult,
  type SchemindOptions,
} from './engine.js'

/* Fetch wrapper (drop-in, non-blocking) */
export {
  createSchemindFetch,
  fetch,
  type SchemindFetchOptions,
} from './fetch.js'

/* CI scanner */
export {
  runScan,
  type RunScanOptions,
  type ScanRoute,
  type ScanRouteResult,
  type ScanSummary,
} from './scan.js'

/* Configuration */
export { defineConfig, type SchemindConfig } from './config.js'

/* Code generation (TS interfaces, JSON Schema / OpenAPI, MSW handlers) */
export {
  endpointToTypeName,
  generateJsonSchema,
  generateMigration,
  generateMsw,
  generateOpenApi,
  generateTypeScript,
  mockFromShape,
  seedFromOpenApi,
  shapeFromJsonSchema,
  shapeToJsonSchema,
  shapeToTypeScript,
  type CodegenSnapshot,
  type JsonSchema,
  type JsonSchemaOptions,
  type OpenApiInfo,
  type TypeScriptOptions,
} from './codegen/index.js'

/* Snapshot store (browser-safe). LocalStorageDriver lives in `schemind/node`. */
export {
  endpointToFilename,
  MemoryStorageDriver,
  SnapshotStore,
  type Acceptance,
  type Clock,
  type CommitOptions,
  type CommitResult,
  type MemoryStorageOptions,
  type Snapshot,
  type SnapshotHistoryEntry,
  type SnapshotStoreOptions,
  type StorageDriver,
} from './snapshot.js'

/* Endpoint health + staleness */
export {
  endpointHealth,
  rankEndpointHealth,
  staleEndpoints,
  type EndpointHealth,
  type StaleEndpoint,
} from './health.js'

/* GraphQL */
export { observeGraphql, type GraphqlObserveInput } from './graphql.js'

/* Environment comparison (F6) */
export { compareShapeSets, type SetComparison } from './compare.js'

/* Replay fixtures (F10) */
export { createFixture, parseFixture, type Fixture } from './fixture.js'

/* Base class for custom drivers — bakes in JSON serialization + read validation */
export {
  JsonStorageDriver,
  serialize as serializeSnapshot,
  type RawRecord,
} from './storage/base.js'

/* Runtime validation (trust boundaries: snapshot files, remote stores) */
export {
  isShapeNode,
  isSnapshot,
  isValidSchemaHash,
  parseSnapshot,
  SchemindValidationError,
} from './validate.js'

/* Reporters + pipeline */
export { consoleReporter, type ConsoleReporterOptions } from './reporters/console.js'
export { describeShape, formatReport, style } from './reporters/format.js'
export { jsonReporter, type JsonReporterOptions } from './reporters/json.js'
export { webhookReporter, type WebhookReporterOptions } from './reporters/webhook.js'
export { slackReporter, type SlackReporterOptions } from './reporters/slack.js'
export { githubReporter, type GitHubReporterOptions } from './reporters/github.js'
export { pagerDutyReporter, type PagerDutyReporterOptions } from './reporters/pagerduty.js'
export {
  otelReporter,
  type OtelReporterOptions,
  type OtelSpan,
  type OtelTracer,
} from './reporters/otel.js'
export { driftToMarkdown, reportToMarkdown } from './reporters/markdown.js'
export { runReporters, type PipelineResult, type ReporterFailure } from './pipeline.js'
