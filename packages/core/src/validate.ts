import type { Snapshot, SnapshotHistoryEntry } from './snapshot.js'
/**
 * Runtime validators for the structures schemind reads back from untrusted
 * boundaries (snapshot files, remote stores, hand-edited JSON).
 *
 * TypeScript can't vouch for bytes it didn't produce, so these guards turn an
 * `unknown` into a verified {@link Snapshot} / {@link ShapeNode} (or a clear
 * error) instead of an unchecked `as` cast. Pure and dependency-free — safe in
 * any runtime.
 */
import type { ScalarType, ShapeNode } from './types.js'

/** Thrown when external data doesn't match an expected schemind structure. */
export class SchemindValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SchemindValidationError'
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

const SCHEMA_HASH_RE = /^[0-9a-f]{8}$/i

/**
 * True when `value` is a well-formed adapter schema hash (8 hex chars). The
 * header is attacker-controllable, so this guards every point that reads it —
 * a bogus value must never enter `meta` or the snapshot store.
 */
export function isValidSchemaHash(value: unknown): value is string {
  return typeof value === 'string' && SCHEMA_HASH_RE.test(value)
}

const SCALAR_TYPES: ReadonlySet<string> = new Set(['string', 'number', 'boolean', 'null'])

function isScalarType(v: unknown): v is ScalarType {
  return typeof v === 'string' && SCALAR_TYPES.has(v)
}

/**
 * Upper bound on shape nesting accepted from untrusted sources. Comfortably
 * above the extractor's default `maxDepth` (32) so legitimate snapshots pass,
 * while rejecting hostile deeply-nested blobs before they can overflow the
 * stack in the diff/stringify recursion. Default cap on `history` length too.
 */
const MAX_VALIDATE_DEPTH = 100
const MAX_HISTORY_LENGTH = 10_000

/** Recursively validate that `v` is a well-formed {@link ShapeNode}. */
export function isShapeNode(v: unknown): v is ShapeNode {
  return checkShapeNode(v, 0)
}

function checkShapeNode(v: unknown, depth: number): boolean {
  if (depth > MAX_VALIDATE_DEPTH) return false
  if (!isRecord(v)) return false
  switch (v.kind) {
    case 'scalar':
      return isScalarType(v.type)
    case 'array':
      return checkShapeNode(v.items, depth + 1)
    case 'object':
      return (
        isRecord(v.fields) && Object.values(v.fields).every((f) => checkShapeNode(f, depth + 1))
      )
    case 'union':
      return Array.isArray(v.types) && v.types.every((t) => checkShapeNode(t, depth + 1))
    default:
      return false
  }
}

function isOptionalString(v: unknown): boolean {
  return v === undefined || typeof v === 'string'
}

function isOptionalAcceptance(v: unknown): boolean {
  if (v === undefined) return true
  return (
    isRecord(v) &&
    typeof v.acceptedAt === 'string' &&
    isOptionalString(v.acceptedBy) &&
    isOptionalString(v.reason)
  )
}

function isHistoryEntry(v: unknown): v is SnapshotHistoryEntry {
  return (
    isRecord(v) &&
    typeof v.snapshotVersion === 'number' &&
    Number.isFinite(v.snapshotVersion) &&
    typeof v.recordedAt === 'string' &&
    isShapeNode(v.shape) &&
    isOptionalString(v.hash) &&
    isOptionalAcceptance(v.acceptance)
  )
}

/** Validate that `v` is a well-formed {@link Snapshot}. */
export function isSnapshot(v: unknown): v is Snapshot {
  return (
    isRecord(v) &&
    typeof v.endpoint === 'string' &&
    typeof v.snapshotVersion === 'number' &&
    Number.isFinite(v.snapshotVersion) &&
    typeof v.createdAt === 'string' &&
    typeof v.updatedAt === 'string' &&
    isShapeNode(v.shape) &&
    isOptionalString(v.hash) &&
    isOptionalAcceptance(v.acceptance) &&
    Array.isArray(v.history) &&
    v.history.length <= MAX_HISTORY_LENGTH &&
    v.history.every(isHistoryEntry)
  )
}

/**
 * Validate and return a {@link Snapshot}, or throw {@link SchemindValidationError}.
 *
 * @param v      the parsed (but untyped) value
 * @param source optional context for the error message (e.g. a filename)
 */
export function parseSnapshot(v: unknown, source?: string): Snapshot {
  if (!isSnapshot(v)) {
    throw new SchemindValidationError(
      `Malformed snapshot${source ? ` (${source})` : ''}: does not match the expected structure`,
    )
  }
  return v
}
