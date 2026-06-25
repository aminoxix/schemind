import type {
  ArrayNode,
  ObjectNode,
  ScalarNode,
  ScalarType,
  ShapeNode,
  UnionNode,
} from './types.js'

/* -------------------------------------------------------------------------- */
/*  Constructors                                                              */
/* -------------------------------------------------------------------------- */

/** Build a {@link ScalarNode}. */
export function scalar(type: ScalarType): ScalarNode {
  return { kind: 'scalar', type }
}

/** Build an {@link ObjectNode}. */
export function object(fields: Record<string, ShapeNode>): ObjectNode {
  return { kind: 'object', fields }
}

/** Build an {@link ArrayNode}. */
export function array(items: ShapeNode): ArrayNode {
  return { kind: 'array', items }
}

/** Build a {@link UnionNode} directly (no normalization). Prefer {@link union}. */
export function unionNode(types: ShapeNode[]): UnionNode {
  return { kind: 'union', types }
}

/**
 * The "unknown" / bottom shape: a union of zero alternatives.
 *
 * Used to represent a value about which we have no structural information —
 * most notably the item type of an *empty* array. Treated as a wildcard by the
 * diff engine (an unknown on either side never produces a change) and absorbed
 * by {@link union} (`union(unknown | T) === T`). Stays within the documented
 * four-kind {@link ShapeNode} system — it is not a new kind.
 */
export const UNKNOWN: UnionNode = { kind: 'union', types: [] }

/** Is this the {@link UNKNOWN} bottom shape (an empty union)? */
export const isUnknown = (n: ShapeNode): boolean => n.kind === 'union' && n.types.length === 0

/* -------------------------------------------------------------------------- */
/*  Type guards                                                               */
/* -------------------------------------------------------------------------- */

export const isObject = (n: ShapeNode): n is ObjectNode => n.kind === 'object'
export const isArray = (n: ShapeNode): n is ArrayNode => n.kind === 'array'
export const isScalar = (n: ShapeNode): n is ScalarNode => n.kind === 'scalar'
export const isUnion = (n: ShapeNode): n is UnionNode => n.kind === 'union'

/** Is this node exactly the `null` scalar? */
export const isNull = (n: ShapeNode): boolean => n.kind === 'scalar' && n.type === 'null'

/* -------------------------------------------------------------------------- */
/*  Canonical stringification                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Produce a deterministic, canonical string for a shape. Object field order and
 * union member order are normalized so that two structurally-equal shapes always
 * stringify identically. Used for equality, deduplication and hashing.
 */
export function stringifyShape(node: ShapeNode): string {
  switch (node.kind) {
    case 'scalar':
      return `s:${node.type}`
    case 'array':
      return `a:[${stringifyShape(node.items)}]`
    case 'object': {
      const entries = Object.keys(node.fields)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${stringifyShape(node.fields[key]!)}`)
      return `o:{${entries.join(',')}}`
    }
    case 'union': {
      const members = node.types.map(stringifyShape).sort()
      return `u:(${members.join('|')})`
    }
  }
}

/** Structural equality, independent of field/union ordering. */
export function shapesEqual(a: ShapeNode, b: ShapeNode): boolean {
  return stringifyShape(a) === stringifyShape(b)
}

/* -------------------------------------------------------------------------- */
/*  Union normalization                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Build a normalized union from a list of member shapes:
 *
 * - flattens nested unions,
 * - deduplicates structurally-equal members,
 * - returns the lone member directly when only one survives (no 1-ary unions),
 * - sorts members canonically for stable output.
 *
 * Nested unions are flattened, so {@link UNKNOWN} members (empty unions) are
 * naturally absorbed: `union([UNKNOWN, T]) === T`. With no surviving members it
 * returns {@link UNKNOWN} (the bottom shape) rather than throwing.
 */
export function union(members: ShapeNode[]): ShapeNode {
  const flat: ShapeNode[] = []
  for (const m of members) {
    if (m.kind === 'union') flat.push(...m.types)
    else flat.push(m)
  }

  const seen = new Map<string, ShapeNode>()
  for (const m of flat) {
    const key = stringifyShape(m)
    if (!seen.has(key)) seen.set(key, m)
  }

  const deduped = [...seen.values()].sort((a, b) =>
    stringifyShape(a) < stringifyShape(b) ? -1 : 1,
  )

  if (deduped.length === 0) return UNKNOWN
  if (deduped.length === 1) return deduped[0]!
  return { kind: 'union', types: deduped }
}

/* -------------------------------------------------------------------------- */
/*  Nullability                                                               */
/* -------------------------------------------------------------------------- */

/** Does this shape admit `null`? True for the `null` scalar or any union containing it. */
export function isNullable(node: ShapeNode): boolean {
  if (isNull(node)) return true
  if (node.kind === 'union') return node.types.some(isNull)
  return false
}

/**
 * Strip `null` out of a shape, returning the "non-null core".
 *
 * - `null` scalar → `null` (no core remains)
 * - `union(T | null)` → `T` (or the reduced union)
 * - anything else → unchanged
 */
export function withoutNull(node: ShapeNode): ShapeNode | null {
  if (isNull(node)) return null
  if (node.kind === 'union') {
    const rest = node.types.filter((t) => !isNull(t))
    if (rest.length === 0) return null
    return union(rest)
  }
  return node
}
