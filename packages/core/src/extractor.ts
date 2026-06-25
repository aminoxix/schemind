import { prunePaths } from './prune.js'
import { UNKNOWN, array, object, scalar, union } from './shape.js'
import type { ShapeNode } from './types.js'

/** Tuning for {@link extractShape}. */
export interface ExtractOptions {
  /**
   * How many leading items of an array to sample when inferring its element
   * shape. Sampled shapes are unioned, so heterogeneous arrays are handled at
   * O(1) cost regardless of array length. Default: `3`.
   *
   * @see ARCHITECTURE.md — "Array sampling strategy"
   */
  arraySampleSize?: number
  /**
   * Maximum nesting depth to walk. Beyond it, the subtree collapses to
   * `UNKNOWN` instead of recursing — a guard against pathologically deep
   * (or hostile) JSON blowing the stack. Default: `32`.
   */
  maxDepth?: number
  /**
   * Object keys to drop from the shape, matched by name at any depth. Use for
   * always-changing fields (`updatedAt`, `requestId`, `timestamp`, …) so they
   * never become baseline noise. Default: none.
   */
  ignore?: readonly string[]
  /**
   * Drop fields by **path** pattern (depth-aware), e.g. `data[].updatedAt`,
   * `*.requestId`, `**.timestamp`. See {@link prunePaths}. Default: none.
   */
  ignorePaths?: readonly string[]
}

const DEFAULT_SAMPLE_SIZE = 3
const DEFAULT_MAX_DEPTH = 32

interface Resolved {
  sampleSize: number
  maxDepth: number
  ignore: ReadonlySet<string>
  ignorePaths: readonly string[]
}

/**
 * Convert an arbitrary JSON value into a {@link ShapeNode} — a structural
 * fingerprint capturing types, nullability and nesting but **never** values.
 *
 * Mapping:
 * - `null` → `scalar('null')`
 * - `string` / `number` / `boolean` → corresponding scalar
 * - array → `array(items)` where `items` is the union of the first
 *   `arraySampleSize` element shapes; an empty array yields `array(UNKNOWN)`
 * - object → `object(fields)` preserving key insertion order, minus {@link ExtractOptions.ignore}
 * - anything past {@link ExtractOptions.maxDepth} → `UNKNOWN`
 *
 * Defensive coercions for non-JSON inputs (this function accepts `unknown`):
 * `undefined` → `scalar('null')`, `bigint` → `scalar('number')`. Functions and
 * symbols are not representable and throw.
 */
export function extractShape(value: unknown, options: ExtractOptions = {}): ShapeNode {
  const resolved: Resolved = {
    sampleSize: Math.max(1, options.arraySampleSize ?? DEFAULT_SAMPLE_SIZE),
    maxDepth: Math.max(1, options.maxDepth ?? DEFAULT_MAX_DEPTH),
    ignore: new Set(options.ignore ?? []),
    ignorePaths: options.ignorePaths ?? [],
  }
  const shape = extract(value, resolved, 0)
  return resolved.ignorePaths.length > 0 ? prunePaths(shape, resolved.ignorePaths) : shape
}

function extract(value: unknown, opts: Resolved, depth: number): ShapeNode {
  if (value === null || value === undefined) return scalar('null')

  // Depth guard: stop descending into containers past the limit.
  if (depth >= opts.maxDepth && (Array.isArray(value) || typeof value === 'object')) {
    return UNKNOWN
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return array(UNKNOWN)
    const sampled = value.slice(0, opts.sampleSize).map((item) => extract(item, opts, depth + 1))
    return array(union(sampled))
  }

  switch (typeof value) {
    case 'string':
      return scalar('string')
    case 'number':
    case 'bigint':
      return scalar('number')
    case 'boolean':
      return scalar('boolean')
    case 'object': {
      const fields: Record<string, ShapeNode> = {}
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        if (opts.ignore.has(key)) continue
        fields[key] = extract(child, opts, depth + 1)
      }
      return object(fields)
    }
    default:
      throw new TypeError(`schemind: cannot extract a shape from a value of type "${typeof value}"`)
  }
}
