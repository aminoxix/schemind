import { describe, expect, it } from 'vitest'
import { extractShape } from '../src/extractor.js'
import { prunePaths } from '../src/prune.js'
import { array, object, scalar } from '../src/shape.js'

describe('prunePaths', () => {
  const shape = object({
    id: scalar('number'),
    updatedAt: scalar('string'),
    user: object({ name: scalar('string'), updatedAt: scalar('string') }),
    items: array(object({ id: scalar('number'), requestId: scalar('string') })),
  })

  it('drops a field at an exact path', () => {
    expect(prunePaths(shape, ['updatedAt'])).toEqual(
      object({
        id: scalar('number'),
        user: object({ name: scalar('string'), updatedAt: scalar('string') }),
        items: array(object({ id: scalar('number'), requestId: scalar('string') })),
      }),
    )
  })

  it('drops one-level wildcards (*.updatedAt)', () => {
    const pruned = prunePaths(shape, ['*.updatedAt'])
    // user.updatedAt removed; root updatedAt kept (different depth)
    expect(pruned).toEqual(
      object({
        id: scalar('number'),
        updatedAt: scalar('string'),
        user: object({ name: scalar('string') }),
        items: array(object({ id: scalar('number'), requestId: scalar('string') })),
      }),
    )
  })

  it('drops fields inside array items (items[].requestId)', () => {
    const pruned = prunePaths(shape, ['items[].requestId'])
    expect(pruned).toEqual(
      object({
        id: scalar('number'),
        updatedAt: scalar('string'),
        user: object({ name: scalar('string'), updatedAt: scalar('string') }),
        items: array(object({ id: scalar('number') })),
      }),
    )
  })

  it('drops at any depth with ** ', () => {
    const pruned = prunePaths(shape, ['**updatedAt'])
    expect(pruned).toEqual(
      object({
        id: scalar('number'),
        user: object({ name: scalar('string') }),
        items: array(object({ id: scalar('number'), requestId: scalar('string') })),
      }),
    )
  })
})

describe('extractShape with ignorePaths', () => {
  it('prunes by path during extraction', () => {
    const shape = extractShape(
      { id: 1, data: [{ id: 2, updatedAt: 'x' }] },
      { ignorePaths: ['data[].updatedAt'] },
    )
    expect(shape).toEqual(
      object({ id: scalar('number'), data: array(object({ id: scalar('number') })) }),
    )
  })
})
