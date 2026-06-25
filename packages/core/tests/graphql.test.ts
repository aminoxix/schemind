import { describe, expect, it } from 'vitest'
import { createSchemind } from '../src/engine.js'
import { observeGraphql } from '../src/graphql.js'

describe('observeGraphql (#8)', () => {
  it('keys on the operation name and strips the {data} envelope', async () => {
    const engine = createSchemind()
    const res = await observeGraphql(engine, {
      query: 'query GetUser { user { id name } }',
      body: { data: { user: { id: 1, name: 'a' } } },
    })
    expect(res.endpoint).toBe('POST /graphql/GetUser')
    expect(res.created).toBe(true)
  })

  it('detects drift on the data shape across operations', async () => {
    const engine = createSchemind()
    await observeGraphql(engine, { operationName: 'Op', body: { data: { a: 1 } } })
    const res = await observeGraphql(engine, { operationName: 'Op', body: { data: { a: 'str' } } })
    expect(res.report?.severity).toBe('breaking')
    expect(res.report?.changes[0]?.type).toBe('type_changed')
  })

  it('falls back to anonymous when no name is available', async () => {
    const engine = createSchemind()
    const res = await observeGraphql(engine, { body: { data: { ok: true } } })
    expect(res.endpoint).toBe('POST /graphql/anonymous')
  })
})
