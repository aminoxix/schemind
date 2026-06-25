import { describe, expect, it } from 'vitest'
import { diffReport, diffShapes } from '../src/diff.js'
import { extractShape } from '../src/extractor.js'
import { UNKNOWN, array, object, scalar, union } from '../src/shape.js'
import type { ChangeType, DriftChange, Severity, ShapeNode } from '../src/types.js'

/** Find the single change at a given path (asserts exactly one). */
function at(changes: DriftChange[], path: string): DriftChange {
  const found = changes.filter((c) => c.path === path)
  expect(found, `expected exactly one change at "${path}"`).toHaveLength(1)
  return found[0]!
}

function expectChange(
  changes: DriftChange[],
  path: string,
  type: ChangeType,
  severity: Severity,
): void {
  const change = at(changes, path)
  expect(change.type).toBe(type)
  expect(change.severity).toBe(severity)
}

const str = scalar('string')
const num = scalar('number')
const bool = scalar('boolean')
const nul = scalar('null')

describe('diff engine — the six change types with correct severity', () => {
  it('field_added → info', () => {
    const from = object({ a: str })
    const to = object({ a: str, b: num })
    expectChange(diffShapes(from, to), 'b', 'field_added', 'info')
  })

  it('field_removed → breaking', () => {
    const from = object({ a: str, b: num })
    const to = object({ a: str })
    expectChange(diffShapes(from, to), 'b', 'field_removed', 'breaking')
  })

  it('type_changed → breaking', () => {
    const from = object({ a: str })
    const to = object({ a: num })
    expectChange(diffShapes(from, to), 'a', 'type_changed', 'breaking')
  })

  it('became_nullable (gained null in a union) → warn', () => {
    const from = object({ a: str })
    const to = object({ a: union([str, nul]) })
    expectChange(diffShapes(from, to), 'a', 'became_nullable', 'warn')
  })

  it('became_nullable (value is now null-only) → warn', () => {
    // The canonical Go/Java demo: Rating float64 → *float64, observed as null.
    const from = object({ rating: num })
    const to = object({ rating: nul })
    expectChange(diffShapes(from, to), 'rating', 'became_nullable', 'warn')
  })

  it('became_required (lost null) → warn', () => {
    const from = object({ a: union([str, nul]) })
    const to = object({ a: str })
    expectChange(diffShapes(from, to), 'a', 'became_required', 'warn')
  })

  it('array_item_changed → breaking', () => {
    const from = object({ tags: array(str) })
    const to = object({ tags: array(num) })
    expectChange(diffShapes(from, to), 'tags[]', 'array_item_changed', 'breaking')
  })
})

describe('diff engine — recursion & paths', () => {
  it('reports nested object additions with a dotted path', () => {
    const from = object({ user: object({ id: num }) })
    const to = object({ user: object({ id: num, name: str }) })
    expectChange(diffShapes(from, to), 'user.name', 'field_added', 'info')
  })

  it('surfaces deeply nested type changes with a precise path', () => {
    const from = object({ a: object({ b: object({ c: str }) }) })
    const to = object({ a: object({ b: object({ c: num }) }) })
    expectChange(diffShapes(from, to), 'a.b.c', 'type_changed', 'breaking')
  })

  it('gives field-level granularity inside array items', () => {
    const from = object({ items: array(object({ id: num })) })
    const to = object({ items: array(object({ id: str })) })
    expectChange(diffShapes(from, to), 'items[].id', 'type_changed', 'breaking')
  })

  it('treats a wholesale array element replacement as array_item_changed', () => {
    const from = object({ items: array(str) })
    const to = object({ items: array(object({ id: num })) })
    expectChange(diffShapes(from, to), 'items[]', 'array_item_changed', 'breaking')
  })
})

describe('diff engine — empty arrays act as a wildcard (no spurious drift)', () => {
  it('populated → empty produces no change', () => {
    const from = object({ tags: array(str) })
    const to = object({ tags: array(UNKNOWN) })
    expect(diffShapes(from, to)).toEqual([])
  })

  it('empty → populated produces no change', () => {
    const from = object({ tags: array(UNKNOWN) })
    const to = object({ tags: array(str) })
    expect(diffShapes(from, to)).toEqual([])
  })
})

describe('diff engine — identical shapes', () => {
  it('reports nothing for structurally-equal shapes', () => {
    const shape: ShapeNode = object({ a: str, b: array(object({ c: bool })) })
    expect(diffShapes(shape, shape)).toEqual([])
  })

  it('is insensitive to object key order', () => {
    const from = object({ a: str, b: num })
    const to = object({ b: num, a: str })
    expect(diffShapes(from, to)).toEqual([])
  })
})

describe('diffReport — severity aggregation', () => {
  it('takes the highest severity among changes', () => {
    const from = object({ a: str, keep: num })
    const to = object({ a: num, added: bool }) // type_changed(breaking) + field_added(info) + field_removed(breaking)
    const report = diffReport('GET /api/x', from, to)
    expect(report.endpoint).toBe('GET /api/x')
    expect(report.severity).toBe('breaking')
    expect(report.changes.length).toBeGreaterThanOrEqual(2)
  })

  it('is info when only additive changes occur', () => {
    const from = object({ a: str })
    const to = object({ a: str, b: num })
    expect(diffReport('GET /api/x', from, to).severity).toBe('info')
  })

  it('is info (no drift) for identical shapes', () => {
    const shape = object({ a: str })
    const report = diffReport('GET /api/x', shape, shape)
    expect(report.severity).toBe('info')
    expect(report.changes).toEqual([])
  })
})

describe('diff engine — end-to-end via extractShape (ARCHITECTURE.md example)', () => {
  it('detects a breaking type change on a real response shape', () => {
    const v1 = extractShape({ user: { id: 42, name: 'A', role: null }, tokens: ['a', 'b'] })
    const v2 = extractShape({ user: { id: '42', name: 'A', role: null }, tokens: ['a', 'b'] })
    const report = diffReport('GET /api/me', v1, v2)
    expect(report.severity).toBe('breaking')
    expectChange(report.changes, 'user.id', 'type_changed', 'breaking')
  })
})
