import { describe, expect, it } from 'vitest'
import { compareShapeSets } from '../src/compare.js'
import { object, scalar } from '../src/shape.js'

describe('compareShapeSets (F6)', () => {
  const base = [
    { endpoint: 'GET /a', shape: object({ x: scalar('string') }) },
    { endpoint: 'GET /only-base', shape: scalar('number') },
  ]
  const target = [
    { endpoint: 'GET /a', shape: object({ x: scalar('number') }) }, // x retyped
    { endpoint: 'GET /only-target', shape: scalar('string') },
  ]

  it('diffs shared endpoints and lists exclusives', () => {
    const cmp = compareShapeSets(base, target)
    expect(cmp.severity).toBe('breaking')
    expect(cmp.reports).toHaveLength(1)
    expect(cmp.reports[0]?.endpoint).toBe('GET /a')
    expect(cmp.onlyInBase).toEqual(['GET /only-base'])
    expect(cmp.onlyInTarget).toEqual(['GET /only-target'])
  })

  it('reports no drift for identical sets', () => {
    const cmp = compareShapeSets(base, base)
    expect(cmp.severity).toBe('info')
    expect(cmp.reports).toEqual([])
  })
})
