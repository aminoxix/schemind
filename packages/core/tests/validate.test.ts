import { describe, expect, it } from 'vitest'
import { array, object, scalar, union } from '../src/shape.js'
import type { Snapshot } from '../src/snapshot.js'
import { SchemindValidationError, isShapeNode, isSnapshot, parseSnapshot } from '../src/validate.js'

describe('isShapeNode', () => {
  it('accepts every valid node kind, recursively', () => {
    expect(isShapeNode(scalar('string'))).toBe(true)
    expect(isShapeNode(array(scalar('number')))).toBe(true)
    expect(isShapeNode(object({ a: scalar('boolean') }))).toBe(true)
    expect(isShapeNode(union([scalar('string'), scalar('null')]))).toBe(true)
    expect(isShapeNode(object({ a: array(object({ b: scalar('null') })) }))).toBe(true)
  })

  it('rejects malformed nodes', () => {
    expect(isShapeNode(null)).toBe(false)
    expect(isShapeNode('string')).toBe(false)
    expect(isShapeNode({})).toBe(false)
    expect(isShapeNode({ kind: 'scalar', type: 'int' })).toBe(false) // bad scalar type
    expect(isShapeNode({ kind: 'array' })).toBe(false) // missing items
    expect(isShapeNode({ kind: 'object', fields: { a: { kind: 'nope' } } })).toBe(false)
    expect(isShapeNode({ kind: 'union', types: 'no' })).toBe(false)
    expect(isShapeNode({ kind: 'mystery' })).toBe(false)
  })

  it('rejects pathologically deep shapes (does not overflow the stack)', () => {
    let node: unknown = scalar('string')
    for (let i = 0; i < 5_000; i++) node = { kind: 'array', items: node }
    expect(isShapeNode(node)).toBe(false)
  })
})

describe('isSnapshot / parseSnapshot', () => {
  const valid: Snapshot = {
    endpoint: 'GET /api/books/:id',
    snapshotVersion: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    shape: object({ id: scalar('number') }),
    history: [],
  }

  it('accepts a well-formed snapshot (with and without optional hash/history)', () => {
    expect(isSnapshot(valid)).toBe(true)
    expect(isSnapshot({ ...valid, hash: 'a3f9b2c1' })).toBe(true)
    expect(
      isSnapshot({
        ...valid,
        snapshotVersion: 2,
        history: [{ snapshotVersion: 1, shape: scalar('string'), recordedAt: 'x' }],
      }),
    ).toBe(true)
  })

  it('rejects structurally-invalid snapshots', () => {
    expect(isSnapshot(null)).toBe(false)
    expect(isSnapshot({ ...valid, endpoint: 123 })).toBe(false)
    expect(isSnapshot({ ...valid, snapshotVersion: 'one' })).toBe(false)
    expect(isSnapshot({ ...valid, shape: { kind: 'bogus' } })).toBe(false)
    expect(isSnapshot({ ...valid, hash: 42 })).toBe(false)
    expect(isSnapshot({ ...valid, history: [{ snapshotVersion: 1 }] })).toBe(false) // entry missing shape
    const noHistory: Record<string, unknown> = { ...valid }
    delete noHistory.history
    expect(isSnapshot(noHistory)).toBe(false)
  })

  it('rejects an absurdly long history (OOM guard)', () => {
    const entry = { snapshotVersion: 1, shape: scalar('string'), recordedAt: 'x' }
    const huge = { ...valid, history: new Array(10_001).fill(entry) }
    expect(isSnapshot(huge)).toBe(false)
  })

  it('accepts valid acceptance metadata and rejects malformed (F8)', () => {
    expect(
      isSnapshot({ ...valid, acceptance: { acceptedAt: 't', acceptedBy: 'a', reason: 'r' } }),
    ).toBe(true)
    expect(isSnapshot({ ...valid, acceptance: { acceptedBy: 'a' } })).toBe(false) // missing acceptedAt
    expect(isSnapshot({ ...valid, acceptance: { acceptedAt: 5 } })).toBe(false)
  })

  it('parseSnapshot returns the value when valid', () => {
    expect(parseSnapshot(valid)).toBe(valid)
  })

  it('parseSnapshot throws a SchemindValidationError with source context when invalid', () => {
    expect(() => parseSnapshot({ bad: true }, 'snap.json')).toThrow(SchemindValidationError)
    expect(() => parseSnapshot({ bad: true }, 'snap.json')).toThrow(/snap\.json/)
  })
})
