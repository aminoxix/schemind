import { describe, expect, it } from 'vitest'
import { extractShape } from '../src/extractor.js'
import { UNKNOWN, array, object, scalar, union } from '../src/shape.js'

describe('extractShape', () => {
  it('maps JSON primitives to scalar nodes', () => {
    expect(extractShape('hi')).toEqual(scalar('string'))
    expect(extractShape(42)).toEqual(scalar('number'))
    expect(extractShape(true)).toEqual(scalar('boolean'))
    expect(extractShape(null)).toEqual(scalar('null'))
  })

  it('extracts nested objects, never values', () => {
    const shape = extractShape({
      user: { id: 42, name: 'Anshumaan', role: null },
      tokens: ['abc', 'def'],
    })
    expect(shape).toEqual(
      object({
        user: object({
          id: scalar('number'),
          name: scalar('string'),
          role: scalar('null'),
        }),
        tokens: array(scalar('string')),
      }),
    )
  })

  it('represents a null field as the null scalar', () => {
    expect(extractShape({ role: null })).toEqual(object({ role: scalar('null') }))
  })

  it('unions heterogeneous array item shapes (deduped)', () => {
    const shape = extractShape([1, 'two', 3])
    expect(shape).toEqual(array(union([scalar('number'), scalar('string')])))
  })

  it('models an empty array as UNKNOWN items', () => {
    expect(extractShape([])).toEqual(array(UNKNOWN))
    expect(extractShape({ tags: [] })).toEqual(object({ tags: array(UNKNOWN) }))
  })

  it('samples only the first 3 items by default (O(1) cost)', () => {
    // 4th item is a number but must not appear in the inferred item shape.
    const shape = extractShape(['a', 'b', 'c', 99])
    expect(shape).toEqual(array(scalar('string')))
  })

  it('respects a custom arraySampleSize', () => {
    const shape = extractShape(['a', 'b', 'c', 99], { arraySampleSize: 4 })
    expect(shape).toEqual(array(union([scalar('number'), scalar('string')])))
  })

  it('handles deep nesting', () => {
    const shape = extractShape({ a: { b: { c: [{ d: 1 }] } } })
    expect(shape).toEqual(
      object({ a: object({ b: object({ c: array(object({ d: scalar('number') })) }) }) }),
    )
  })

  it('unions object shapes across sampled array items', () => {
    const shape = extractShape([{ id: 1 }, { id: 2, extra: true }])
    expect(shape).toEqual(
      array(
        union([
          object({ id: scalar('number') }),
          object({ id: scalar('number'), extra: scalar('boolean') }),
        ]),
      ),
    )
  })

  it('coerces non-JSON inputs defensively', () => {
    expect(extractShape(undefined)).toEqual(scalar('null'))
    expect(extractShape(10n)).toEqual(scalar('number'))
  })

  it('throws on unrepresentable values', () => {
    expect(() => extractShape(() => {})).toThrow(TypeError)
    expect(() => extractShape(Symbol('x'))).toThrow(TypeError)
  })

  it('collapses nesting beyond maxDepth to UNKNOWN (no stack overflow)', () => {
    expect(extractShape({ a: { b: { c: 1 } } }, { maxDepth: 2 })).toEqual(
      object({ a: object({ b: UNKNOWN }) }),
    )
    // A pathologically deep object must not blow the stack.
    let deep: unknown = 1
    for (let i = 0; i < 100_000; i++) deep = { a: deep }
    expect(() => extractShape(deep, { maxDepth: 32 })).not.toThrow()
  })

  it('drops ignored fields at any depth', () => {
    const shape = extractShape(
      { id: 1, updatedAt: 'x', user: { name: 'a', requestId: 'r' } },
      { ignore: ['updatedAt', 'requestId'] },
    )
    expect(shape).toEqual(
      object({ id: scalar('number'), user: object({ name: scalar('string') }) }),
    )
  })
})
