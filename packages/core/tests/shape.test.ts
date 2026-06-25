import { describe, expect, it } from 'vitest'
import {
  UNKNOWN,
  array,
  isNullable,
  object,
  scalar,
  shapesEqual,
  stringifyShape,
  union,
  withoutNull,
} from '../src/shape.js'

const str = scalar('string')
const num = scalar('number')
const nul = scalar('null')

describe('union normalization', () => {
  it('deduplicates structurally-equal members', () => {
    expect(union([str, str, num])).toEqual(union([str, num]))
  })

  it('collapses a single surviving member to that member (no 1-ary unions)', () => {
    expect(union([str, str])).toEqual(str)
  })

  it('flattens nested unions', () => {
    const nested = union([union([str, num]), nul])
    expect(nested).toEqual(union([str, num, nul]))
  })

  it('absorbs UNKNOWN (the bottom shape)', () => {
    expect(union([UNKNOWN, str])).toEqual(str)
  })

  it('returns UNKNOWN for an empty member list', () => {
    expect(union([])).toEqual(UNKNOWN)
    expect(union([UNKNOWN, UNKNOWN])).toEqual(UNKNOWN)
  })

  it('orders members canonically and stably', () => {
    expect(stringifyShape(union([num, str]))).toBe(stringifyShape(union([str, num])))
  })
})

describe('stringifyShape / shapesEqual', () => {
  it('is independent of object key order', () => {
    expect(shapesEqual(object({ a: str, b: num }), object({ b: num, a: str }))).toBe(true)
  })

  it('distinguishes different shapes', () => {
    expect(shapesEqual(array(str), array(num))).toBe(false)
    expect(shapesEqual(str, num)).toBe(false)
  })
})

describe('nullability helpers', () => {
  it('isNullable detects the null scalar and unions containing it', () => {
    expect(isNullable(nul)).toBe(true)
    expect(isNullable(union([str, nul]))).toBe(true)
    expect(isNullable(str)).toBe(false)
    expect(isNullable(union([str, num]))).toBe(false)
  })

  it('withoutNull strips null from a union', () => {
    expect(withoutNull(union([str, nul]))).toEqual(str)
    expect(withoutNull(union([str, num, nul]))).toEqual(union([str, num]))
  })

  it('withoutNull returns null when no non-null core remains', () => {
    expect(withoutNull(nul)).toBeNull()
  })

  it('withoutNull leaves non-nullable shapes unchanged', () => {
    expect(withoutNull(str)).toEqual(str)
  })
})
