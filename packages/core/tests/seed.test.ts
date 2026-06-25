import { describe, expect, it } from 'vitest'
import { seedFromOpenApi, shapeFromJsonSchema } from '../src/codegen/index.js'
import { array, object, scalar, union } from '../src/shape.js'

describe('shapeFromJsonSchema (F3 seeding)', () => {
  it('maps scalars (integer → number)', () => {
    expect(shapeFromJsonSchema({ type: 'string' })).toEqual(scalar('string'))
    expect(shapeFromJsonSchema({ type: 'integer' })).toEqual(scalar('number'))
    expect(shapeFromJsonSchema({ type: 'boolean' })).toEqual(scalar('boolean'))
  })

  it('maps objects and arrays', () => {
    expect(
      shapeFromJsonSchema({
        type: 'object',
        properties: { id: { type: 'integer' }, tags: { type: 'array', items: { type: 'string' } } },
      }),
    ).toEqual(object({ id: scalar('number'), tags: array(scalar('string')) }))
  })

  it('treats nullable + type arrays as unions with null', () => {
    expect(shapeFromJsonSchema({ type: 'string', nullable: true })).toEqual(
      union([scalar('string'), scalar('null')]),
    )
    expect(shapeFromJsonSchema({ type: ['string', 'null'] })).toEqual(
      union([scalar('string'), scalar('null')]),
    )
  })

  it('resolves local $ref', () => {
    const root = {
      components: { schemas: { Book: { type: 'object', properties: { id: { type: 'string' } } } } },
    }
    expect(shapeFromJsonSchema({ $ref: '#/components/schemas/Book' }, root)).toEqual(
      object({ id: scalar('string') }),
    )
  })
})

describe('seedFromOpenApi', () => {
  it('extracts endpoint shapes from an OpenAPI doc', () => {
    const doc = {
      openapi: '3.0.3',
      paths: {
        '/books/{id}': {
          get: {
            responses: {
              '200': {
                content: { 'application/json': { schema: { $ref: '#/components/schemas/Book' } } },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Book: {
            type: 'object',
            properties: { id: { type: 'string' }, rating: { type: 'number', nullable: true } },
          },
        },
      },
    }
    const seeds = seedFromOpenApi(doc)
    expect(seeds).toHaveLength(1)
    expect(seeds[0]?.endpoint).toBe('GET /books/:id')
    expect(seeds[0]?.shape).toEqual(
      object({ id: scalar('string'), rating: union([scalar('number'), scalar('null')]) }),
    )
  })

  it('returns nothing for a spec without JSON responses', () => {
    expect(seedFromOpenApi({ paths: {} })).toEqual([])
  })
})
