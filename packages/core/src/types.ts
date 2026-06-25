/**
 * schemind core type system.
 *
 * These types are the backbone of the entire pipeline. They are intentionally
 * pure and structural — a {@link ShapeNode} never carries an actual response
 * value, only the *shape* of the data. Do not rename or restructure these
 * without updating every dependent module (extractor, diff engine, snapshot
 * store, reporters).
 *
 * @see ARCHITECTURE.md — full system design
 * @see SKILL.md — "Core type system"
 */

/* -------------------------------------------------------------------------- */
/*  Shape representation                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The set of JSON-primitive types a {@link ScalarNode} can represent.
 *
 * `null` is modelled as its own scalar type (rather than a nullability flag)
 * so that the diff engine can reason about `string` → `null` transitions
 * uniformly. Nullable fields are expressed as a {@link UnionNode} of the
 * concrete type plus `{ kind: 'scalar', type: 'null' }`.
 */
export type ScalarType = 'string' | 'number' | 'boolean' | 'null'

/** An object with a fixed set of named fields, each its own shape. */
export interface ObjectNode {
  kind: 'object'
  fields: Record<string, ShapeNode>
}

/** A homogeneous list. Heterogeneous arrays collapse their item shapes into a {@link UnionNode}. */
export interface ArrayNode {
  kind: 'array'
  items: ShapeNode
}

/** A JSON primitive. */
export interface ScalarNode {
  kind: 'scalar'
  type: ScalarType
}

/** A set of mutually-exclusive alternative shapes (e.g. nullable or mixed-type fields). */
export interface UnionNode {
  kind: 'union'
  types: ShapeNode[]
}

/**
 * A structural fingerprint of a JSON value: types, nullability and nesting,
 * but **never** the underlying values.
 */
export type ShapeNode = ObjectNode | ArrayNode | ScalarNode | UnionNode

/** Discriminant tag of a {@link ShapeNode}. */
export type ShapeKind = ShapeNode['kind']

/* -------------------------------------------------------------------------- */
/*  Observation                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Metadata sourced from optional backend adapter headers
 * (`X-Schemind-Schema-Hash`, `X-Schemind-Schema-Version`, `X-Schemind-Source`).
 *
 * Present only when a satellite adapter (schemind-go / -java / -py) is installed
 * on the backend. The core works fully without it.
 */
export interface AdapterMeta {
  /** 8-char SHA-256 of the backend struct definition. Enables the hash fast-path. */
  schemaHash?: string
  /** Backend's own monotonic version counter for this response type. */
  schemaVersion?: number
  /** Source `file:line` of the response struct. Dev/staging only, never production. */
  source?: string
}

/** A single observed API response, reduced to its shape. */
export interface ObservedResponse {
  /** Normalized endpoint, e.g. `GET /api/users/:id`. */
  endpoint: string
  /** HTTP status code of the observed response. */
  statusCode: number
  /** Extracted structure — never values. */
  shape: ShapeNode
  /** ISO-8601 timestamp of when the response was observed. */
  observedAt: string
  /** Enrichment from backend adapter headers, when present. */
  meta?: AdapterMeta
}

/* -------------------------------------------------------------------------- */
/*  Drift                                                                     */
/* -------------------------------------------------------------------------- */

/** Triage tiers, ordered from least to most urgent. */
export type Severity = 'info' | 'warn' | 'breaking'

/**
 * The taxonomy of structural changes the diff engine can detect.
 * Severity is derived deterministically from this tag — see
 * {@link SEVERITY_BY_CHANGE_TYPE}.
 */
export type ChangeType =
  | 'field_added' // info
  | 'field_removed' // breaking
  | 'type_changed' // breaking
  | 'became_nullable' // warn
  | 'became_required' // warn
  | 'array_item_changed' // breaking

/** A single field-level structural change between two shapes. */
export interface DriftChange {
  /** Dot-notation path to the changed node, e.g. `user.role` or `items[].id`. */
  path: string
  /** What kind of change occurred. */
  type: ChangeType
  /** Severity derived from {@link type}. */
  severity: Severity
  /** Shape before the change (absent for additions). */
  from?: ShapeNode
  /** Shape after the change (absent for removals). */
  to?: ShapeNode
}

/** The full structural diff for a single endpoint observation. */
export interface DriftReport {
  /** Normalized endpoint the report concerns. */
  endpoint: string
  /** Highest severity among {@link changes}. `info` when there are no changes. */
  severity: Severity
  /** Every detected change, in stable document order. */
  changes: DriftChange[]
}

/* -------------------------------------------------------------------------- */
/*  Reporters                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A sink for drift reports. Reporters are composed into a pipeline; multiple
 * may be active simultaneously. Implementations must never throw — a failing
 * reporter must not break the others (the pipeline isolates failures).
 */
export interface Reporter {
  /** Stable identifier, e.g. `console`, `slack`. */
  readonly name: string
  /** Emit a single drift report. */
  report(drift: DriftReport): Promise<void>
}
