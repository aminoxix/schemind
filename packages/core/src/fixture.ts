import type { ShapeNode } from './types.js'
import { SchemindValidationError, isShapeNode } from './validate.js'

/**
 * A portable, **values-free** recording of observed endpoint shapes. Capture it
 * from one environment (`schm record`) and replay it against another
 * (`schm replay`) — "replay last week's real responses against a deploy
 * candidate". Carries only structure, never response data, so it's safe to
 * commit and share.
 */
export interface Fixture {
  version: 1
  recordedAt: string
  /** Endpoint key → observed shape. */
  shapes: Record<string, ShapeNode>
}

/** Build a {@link Fixture} from endpoint→shape pairs. */
export function createFixture(
  entries: readonly { endpoint: string; shape: ShapeNode }[],
  now: string = new Date().toISOString(),
): Fixture {
  const shapes: Record<string, ShapeNode> = {}
  for (const { endpoint, shape } of entries) shapes[endpoint] = shape
  return { version: 1, recordedAt: now, shapes }
}

/** Validate and parse an untrusted value into a {@link Fixture}, or throw. */
export function parseFixture(value: unknown, source?: string): Fixture {
  const where = source ? ` (${source})` : ''
  if (typeof value !== 'object' || value === null) {
    throw new SchemindValidationError(`Malformed fixture${where}: not an object`)
  }
  const v = value as Record<string, unknown>
  if (v.version !== 1) {
    throw new SchemindValidationError(`Unsupported fixture version${where}`)
  }
  if (typeof v.shapes !== 'object' || v.shapes === null) {
    throw new SchemindValidationError(`Malformed fixture${where}: missing shapes`)
  }
  const shapes: Record<string, ShapeNode> = {}
  for (const [endpoint, shape] of Object.entries(v.shapes as Record<string, unknown>)) {
    if (!isShapeNode(shape)) {
      throw new SchemindValidationError(`Malformed fixture${where}: bad shape for "${endpoint}"`)
    }
    shapes[endpoint] = shape
  }
  const recordedAt = typeof v.recordedAt === 'string' ? v.recordedAt : new Date(0).toISOString()
  return { version: 1, recordedAt, shapes }
}
