import { highestSeverity, severityOf } from './severity.js'
import { isUnknown, shapesEqual, withoutNull } from './shape.js'
import type { ChangeType, DriftChange, DriftReport, ShapeNode } from './types.js'

/**
 * Compare a previously-stored shape (`from`) against a newly-observed shape
 * (`to`) and produce the list of field-level {@link DriftChange}s, in stable
 * document order.
 *
 * Classification rules (see SKILL.md — "Severity rules"):
 * - a field present in `from` but not `to` → `field_removed` (breaking)
 * - a field present in `to` but not `from` → `field_added` (info)
 * - a scalar/container whose underlying type changed → `type_changed` (breaking)
 * - a value that gained `null` → `became_nullable` (warn)
 * - a value that lost `null` → `became_required` (warn)
 * - an array whose element shape changed wholesale → `array_item_changed` (breaking)
 *
 * Object fields and array items are diffed recursively, so deeply-nested changes
 * surface with a precise dot/bracket path (e.g. `user.roles[].name`).
 */
export function diffShapes(from: ShapeNode, to: ShapeNode): DriftChange[] {
  const changes: DriftChange[] = []
  diffNode(from, to, '', changes)
  return changes
}

/** Build a full {@link DriftReport} for one endpoint from two shapes. */
export function diffReport(endpoint: string, from: ShapeNode, to: ShapeNode): DriftReport {
  const changes = diffShapes(from, to)
  return {
    endpoint,
    severity: highestSeverity(changes.map((c) => c.severity)),
    changes,
  }
}

/* -------------------------------------------------------------------------- */
/*  Internals                                                                  */
/* -------------------------------------------------------------------------- */

function push(
  changes: DriftChange[],
  type: ChangeType,
  path: string,
  from: ShapeNode | undefined,
  to: ShapeNode | undefined,
): void {
  const change: DriftChange = { path, type, severity: severityOf(type) }
  if (from !== undefined) change.from = from
  if (to !== undefined) change.to = to
  changes.push(change)
}

function diffNode(from: ShapeNode, to: ShapeNode, path: string, changes: DriftChange[]): void {
  // Identical shapes — nothing to report.
  if (shapesEqual(from, to)) return

  const fromCore = withoutNull(from) // ShapeNode | null  (null === "no non-null core")
  const toCore = withoutNull(to)

  // Pure-null transitions: one side carries no non-null core.
  if (fromCore === null && toCore === null) return // both null-only, already equal
  if (fromCore === null) {
    // was null-only, now carries a concrete required type
    push(changes, 'became_required', path, from, to)
    return
  }
  if (toCore === null) {
    // concrete type is now (only) null
    push(changes, 'became_nullable', path, from, to)
    return
  }

  // Both sides have a non-null core.
  if (shapesEqual(fromCore, toCore)) {
    // Cores match — the only difference is nullability.
    const fromNull = from.kind === 'union' && from.types.some(isNullScalar)
    const toNull = to.kind === 'union' && to.types.some(isNullScalar)
    if (!fromNull && toNull) push(changes, 'became_nullable', path, from, to)
    else if (fromNull && !toNull) push(changes, 'became_required', path, from, to)
    return
  }

  // Cores differ structurally — recurse where both sides are the same container,
  // otherwise it is a wholesale type change.
  if (fromCore.kind === 'object' && toCore.kind === 'object') {
    diffObject(fromCore.fields, toCore.fields, path, changes)
    return
  }
  if (fromCore.kind === 'array' && toCore.kind === 'array') {
    diffArray(fromCore.items, toCore.items, path, changes)
    return
  }

  push(changes, 'type_changed', path, from, to)
}

function diffObject(
  from: Record<string, ShapeNode>,
  to: Record<string, ShapeNode>,
  path: string,
  changes: DriftChange[],
): void {
  // Existing keys first (removals + recursive changes), preserving `from` order.
  for (const key of Object.keys(from)) {
    const childPath = join(path, key)
    const fromChild = from[key]!
    if (!(key in to)) {
      push(changes, 'field_removed', childPath, fromChild, undefined)
      continue
    }
    diffNode(fromChild, to[key]!, childPath, changes)
  }
  // Then additions, preserving `to` order.
  for (const key of Object.keys(to)) {
    if (key in from) continue
    push(changes, 'field_added', join(path, key), undefined, to[key]!)
  }
}

function diffArray(
  fromItems: ShapeNode,
  toItems: ShapeNode,
  path: string,
  changes: DriftChange[],
): void {
  const itemPath = `${path}[]`

  // An empty array carries no item information — treat unknown as a wildcard so
  // empty→populated (and vice-versa) never produces spurious drift.
  if (isUnknown(fromItems) || isUnknown(toItems)) return
  if (shapesEqual(fromItems, toItems)) return

  // Recurse for same-container items to surface granular, well-pathed changes…
  if (fromItems.kind === 'object' && toItems.kind === 'object') {
    diffObject(fromItems.fields, toItems.fields, itemPath, changes)
    return
  }
  if (fromItems.kind === 'array' && toItems.kind === 'array') {
    diffArray(fromItems.items, toItems.items, itemPath, changes)
    return
  }

  // …otherwise the element type changed wholesale.
  push(changes, 'array_item_changed', itemPath, fromItems, toItems)
}

function isNullScalar(n: ShapeNode): boolean {
  return n.kind === 'scalar' && n.type === 'null'
}

function join(path: string, key: string): string {
  return path ? `${path}.${key}` : key
}
