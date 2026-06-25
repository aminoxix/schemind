import { describe, expect, it, vi } from 'vitest'
import { schemindExpress } from '../src/adapters/express.js'
import { schemindHono } from '../src/adapters/hono.js'
import { withSchemind } from '../src/adapters/next.js'
import { type ObserveResult, createSchemind } from '../src/engine.js'
import { extractShape } from '../src/extractor.js'
import { createFixture } from '../src/fixture.js'
import { MemoryStorageDriver, SnapshotStore } from '../src/snapshot.js'

/** An engine plus a promise that resolves on the next observation. */
function harness() {
  const engine = createSchemind()
  let resolve!: (r: ObserveResult) => void
  const next = new Promise<ObserveResult>((r) => {
    resolve = r
  })
  return { engine, onObserve: resolve, next }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('schemindExpress', () => {
  it('wraps res.json, forwards the body, and observes the shape', async () => {
    const { engine, onObserve, next } = harness()
    const mw = schemindExpress({ engine, onObserve })

    const sent: unknown[] = []
    const res = {
      statusCode: 200,
      json(body: unknown) {
        sent.push(body)
        return body
      },
    }
    const nextFn = vi.fn()
    mw({ method: 'GET', url: '/api/users/1', originalUrl: '/api/users/1' }, res, nextFn)
    expect(nextFn).toHaveBeenCalledOnce()

    res.json({ id: 1, name: 'a' })
    expect(sent[0]).toEqual({ id: 1, name: 'a' }) // body forwarded unchanged

    const result = await next
    expect(result.endpoint).toBe('GET /api/users/:id')
    expect(result.created).toBe(true)
  })

  it('tracks the request-body shape when req.body is populated (#2)', async () => {
    const { engine, onObserve, next } = harness()
    const mw = schemindExpress({ engine, onObserve })
    const res = {
      statusCode: 200,
      json(body: unknown) {
        return body
      },
    }
    mw(
      {
        method: 'POST',
        url: '/api/login',
        originalUrl: '/api/login',
        body: { email: 'a', password: 'b' },
      },
      res,
      () => {},
    )
    res.json({ token: 't' })

    const result = await next
    expect(result.endpoint).toBe('POST /api/login')
    // the request body is tracked under its own baseline
    expect(await engine.getStore().list()).toContain('POST /api/login [request]')
  })
})

describe('withSchemind (Next.js)', () => {
  it('returns the response unchanged and observes its shape', async () => {
    const { engine, onObserve, next } = harness()
    const handler = vi.fn(async () => jsonResponse({ data: [{ id: 1 }], count: 1 }))
    const wrapped = withSchemind(handler, { engine, onObserve })

    const res = await wrapped(new Request('http://localhost/api/books'))
    expect(await res.json()).toEqual({ data: [{ id: 1 }], count: 1 }) // intact for the caller

    const result = await next
    expect(result.endpoint).toBe('GET http://localhost/api/books')
  })
})

describe('schemindHono', () => {
  it('observes c.res after next()', async () => {
    const { engine, onObserve, next } = harness()
    const mw = schemindHono({ engine, onObserve })
    const ctx = {
      req: { method: 'GET', url: 'http://localhost/api/books', json: () => Promise.resolve({}) },
      res: jsonResponse({ data: [], count: 0 }),
    }
    await mw(ctx, async () => {})
    const result = await next
    expect(result.endpoint).toBe('GET http://localhost/api/books')
  })

  it('tracks the request body on a POST (#5)', async () => {
    const { engine, onObserve, next } = harness()
    const mw = schemindHono({ engine, includeOrigin: false, onObserve })
    const ctx = {
      req: {
        method: 'POST',
        url: 'http://localhost/api/login',
        json: () => Promise.resolve({ email: 'a', password: 'b' }),
      },
      res: jsonResponse({ token: 't' }),
    }
    await mw(ctx, async () => {})
    await next
    expect((await engine.getStore().list()).some((e) => e.endsWith('/api/login [request]'))).toBe(
      true,
    )
  })
})

describe('withSchemind request-body tracking (#5)', () => {
  it('tracks the request body shape from a cloned request', async () => {
    const { engine, onObserve, next } = harness()
    const handler = async (req: Request) => {
      await req.json() // handler consumes the body; our pre-clone must still work
      return jsonResponse({ token: 't' })
    }
    const wrapped = withSchemind(handler, { engine, includeOrigin: false, onObserve })
    await wrapped(
      new Request('http://localhost/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'a', password: 'b' }),
      }),
    )
    await next
    expect((await engine.getStore().list()).some((e) => e.endsWith('/api/login [request]'))).toBe(
      true,
    )
  })
})

describe('replay a fixture through middleware (#10)', () => {
  it('seeds a baseline from a fixture and detects drift via the Express adapter', async () => {
    // Recorded last week: GET /api/books returned { id, title }.
    const fixture = createFixture([
      { endpoint: 'GET /api/books', shape: extractShape({ id: 1, title: 'A' }) },
    ])
    const store = new SnapshotStore(new MemoryStorageDriver())
    for (const [endpoint, shape] of Object.entries(fixture.shapes))
      await store.commit(endpoint, shape)

    const { onObserve, next } = harness()
    const engine = createSchemind({ store, includeOrigin: false })
    const mw = schemindExpress({ engine, onObserve })

    // Candidate now returns { id, name } (title → name).
    const res = { statusCode: 200, json: (b: unknown) => b }
    mw({ method: 'GET', url: '/api/books', originalUrl: '/api/books' }, res, () => {})
    res.json({ id: 1, name: 'A' })

    const result = await next
    expect(result.report?.severity).toBe('breaking')
  })
})
