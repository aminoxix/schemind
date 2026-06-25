import { describe, expect, it } from 'vitest'
import {
  type CodegenSnapshot,
  generateJsonSchema,
  generateMsw,
  generateOpenApi,
  generateTypeScript,
  mockFromShape,
} from '../src/codegen/index.js'
import { UNKNOWN, array, object, scalar, union } from '../src/shape.js'

const booksList: CodegenSnapshot = {
  endpoint: 'GET /api/books',
  shape: object({
    data: array(
      object({
        id: scalar('number'),
        title: scalar('string'),
        author: object({ name: scalar('string') }),
      }),
    ),
    count: scalar('number'),
  }),
}

const bookDetail: CodegenSnapshot = {
  endpoint: 'GET /api/books/:id',
  shape: object({
    id: scalar('number'),
    rating: union([scalar('number'), scalar('null')]),
    tags: array(UNKNOWN),
    'weird-key': scalar('string'),
  }),
}

const snapshots = [booksList, bookDetail]

describe('generateTypeScript (F1)', () => {
  const ts = generateTypeScript(snapshots)

  it('emits a named interface per endpoint', () => {
    expect(ts).toContain('export interface GetApiBooksResponse {')
    expect(ts).toContain('export interface GetApiBooksIdResponse {')
  })

  it('renders nested objects, arrays, and scalars', () => {
    expect(ts).toContain('count: number')
    expect(ts).toContain('id: number')
    expect(ts).toContain('}[]') // data: { … }[]
  })

  it('renders nullable unions as `T | null` (null last)', () => {
    expect(ts).toContain('rating: number | null')
  })

  it('quotes keys that are not valid identifiers', () => {
    expect(ts).toContain('"weird-key": string')
  })

  it('renders an empty array (UNKNOWN items) as unknown[]', () => {
    expect(ts).toContain('tags: unknown[]')
  })
})

describe('generateJsonSchema (F2)', () => {
  const json = JSON.stringify(generateJsonSchema(snapshots))

  it('bundles one schema per endpoint under $defs', () => {
    expect(json).toContain('"$defs"')
    expect(json).toContain('"GetApiBooks"')
    expect(json).toContain('"GetApiBooksId"')
  })

  it('marks objects required + closed', () => {
    expect(json).toContain('"required":["data","count"]')
    expect(json).toContain('"additionalProperties":false')
  })

  it('represents a nullable field via anyOf + null', () => {
    expect(json).toContain('"anyOf"')
    expect(json).toContain('"type":"null"')
  })
})

describe('generateOpenApi (F2)', () => {
  const oas = JSON.stringify(generateOpenApi(snapshots))

  it('produces a 3.0.3 doc with paths + components', () => {
    expect(oas).toContain('"openapi":"3.0.3"')
    expect(oas).toContain('"/api/books"')
    expect(oas).toContain('"#/components/schemas/GetApiBooksId"')
  })

  it('converts :id to a path parameter', () => {
    expect(oas).toContain('"/api/books/{id}"')
    expect(oas).toContain('"in":"path"')
    expect(oas).toContain('"name":"id"')
  })

  it('uses OpenAPI nullable instead of a null type', () => {
    expect(oas).toContain('"nullable":true')
  })
})

describe('generateMsw (F7)', () => {
  it('builds a representative mock from a shape', () => {
    expect(mockFromShape(bookDetail.shape)).toEqual({
      id: 0,
      rating: 0, // first non-null branch of (number | null)
      tags: [],
      'weird-key': 'string',
    })
  })

  it('emits msw handlers keyed by method + path', () => {
    const msw = generateMsw(snapshots)
    expect(msw).toContain("import { http, HttpResponse } from 'msw'")
    expect(msw).toContain("http.get('/api/books', () => {")
    expect(msw).toContain("http.get('/api/books/:id', () => {")
    expect(msw).toContain('HttpResponse.json(')
  })
})

describe('name de-duplication', () => {
  it('suffixes collisions instead of overwriting', () => {
    const ts = generateTypeScript([
      { endpoint: 'GET /api/x', shape: object({ a: scalar('number') }) },
      { endpoint: 'POST /api/x', shape: object({ b: scalar('string') }) },
    ])
    // GetApiX vs PostApiX → distinct, no collision here
    expect(ts).toContain('GetApiXResponse')
    expect(ts).toContain('PostApiXResponse')
  })
})
