import { type Server, createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ObserveResult } from '../src/engine.js'
import { type SchemindFetchOptions, createSchemindFetch } from '../src/fetch.js'

/** Mutable server state the tests reconfigure between requests to simulate drift. */
const state: {
  status: number
  contentType: string
  body: unknown
  headers: Record<string, string>
  omitLength: boolean
} = {
  status: 200,
  contentType: 'application/json',
  body: {},
  headers: {},
  omitLength: false,
}

let server: Server
let baseUrl: string

beforeAll(async () => {
  server = createServer((_req, res) => {
    const payload = state.contentType.includes('json')
      ? JSON.stringify(state.body)
      : String(state.body)
    res.writeHead(state.status, {
      'content-type': state.contentType,
      ...(state.omitLength ? {} : { 'content-length': Buffer.byteLength(payload) }),
      ...state.headers,
    })
    res.end(payload)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${port}`
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  )
})

/** A wrapped fetch + a way to await the async observation that follows each call. */
function makeFetch(opts: Partial<SchemindFetchOptions> = {}) {
  const pending: ObserveResult[] = []
  const resolvers: Array<(r: ObserveResult) => void> = []
  const onObserve = (r: ObserveResult): void => {
    const next = resolvers.shift()
    if (next) next(r)
    else pending.push(r)
  }
  const nextObserve = (): Promise<ObserveResult> => {
    const queued = pending.shift()
    if (queued) return Promise.resolve(queued)
    return new Promise((resolve) => resolvers.push(resolve))
  }
  const fetch = createSchemindFetch({ ...opts, onObserve })
  return { fetch, nextObserve }
}

describe('createSchemindFetch — end-to-end drift detection over HTTP', () => {
  it('returns the real response untouched to the caller', async () => {
    state.body = { id: '1', title: 'Refactoring', rating: 4.5 }
    const { fetch } = makeFetch()
    const res = await fetch(`${baseUrl}/api/books/1`)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ id: '1', title: 'Refactoring', rating: 4.5 })
  })

  it('learns a baseline, then flags a breaking change on the same endpoint', async () => {
    const { fetch, nextObserve } = makeFetch()

    // v1 — first sighting establishes the baseline.
    state.body = { id: '1', title: 'Refactoring', author: 'Fowler', rating: 4.5 }
    await fetch(`${baseUrl}/api/books/1`)
    const first = await nextObserve()
    expect(first.created).toBe(true)
    expect(first.report).toBeNull()
    expect(first.endpoint).toMatch(/^GET http:\/\/127\.0\.0\.1:\d+\/api\/books\/:id$/)

    // v2 — backend renamed `author` → `authorInfo` (the README's breaking drift).
    state.body = { id: '2', title: 'Clean Code', authorInfo: 'Martin', rating: 4.2 }
    await fetch(`${baseUrl}/api/books/2`) // different id → same normalized endpoint
    const second = await nextObserve()

    expect(second.created).toBe(false)
    expect(second.report?.severity).toBe('breaking')
    const byPath = Object.fromEntries((second.report?.changes ?? []).map((c) => [c.path, c.type]))
    expect(byPath.author).toBe('field_removed')
    expect(byPath.authorInfo).toBe('field_added')
  })

  it('detects a warn-level nullability change', async () => {
    const { fetch, nextObserve } = makeFetch()
    state.body = { id: '1', rating: 4.5 }
    await fetch(`${baseUrl}/api/warn/1`)
    await nextObserve()

    state.body = { id: '2', rating: null } // rating became nullable
    await fetch(`${baseUrl}/api/warn/2`)
    const res = await nextObserve()
    expect(res.report?.severity).toBe('warn')
    expect(res.report?.changes[0]?.type).toBe('became_nullable')
  })

  it('does not learn error (non-2xx) responses', async () => {
    const { fetch, nextObserve } = makeFetch()
    state.status = 404
    state.body = { error: 'not found', code: 404 }
    const res = await fetch(`${baseUrl}/api/books/missing`)
    expect(res.status).toBe(404)
    const observed = await nextObserve()
    state.status = 200
    expect(observed.skipped).toBe(true)
    expect(observed.report).toBeNull()
    expect(observed.created).toBe(false)
  })

  it('parses adapter headers into meta, excluding source by default', async () => {
    const { fetch, nextObserve } = makeFetch()
    state.body = { id: '1' }
    state.headers = {
      'X-Schemind-Schema-Hash': 'a3f9b2c1',
      'X-Schemind-Schema-Version': '14',
      'X-Schemind-Source': 'BookResponse@handlers/books.go:42',
    }
    await fetch(`${baseUrl}/api/meta/1`)
    const res = await nextObserve()
    state.headers = {}
    // source omitted unless includeSource is set
    expect(res.observed.meta).toEqual({ schemaHash: 'a3f9b2c1', schemaVersion: 14 })
  })

  it('drops a malformed X-Schemind-Schema-Hash at the read boundary (#3)', async () => {
    const { fetch, nextObserve } = makeFetch()
    state.body = { id: '1' }
    state.headers = { 'X-Schemind-Schema-Hash': '1', 'X-Schemind-Schema-Version': '14' }
    await fetch(`${baseUrl}/api/hash/1`)
    const res = await nextObserve()
    state.headers = {}
    // version is kept; the bogus hash never enters meta
    expect(res.observed.meta).toEqual({ schemaVersion: 14 })
  })

  it('omits meta entirely when only a malformed hash is present', async () => {
    const { fetch, nextObserve } = makeFetch()
    state.body = { id: '1' }
    state.headers = { 'X-Schemind-Schema-Hash': 'nothex!!' }
    await fetch(`${baseUrl}/api/hash/2`)
    const res = await nextObserve()
    state.headers = {}
    expect(res.observed.meta).toBeUndefined()
  })

  it('includes source only when includeSource is enabled', async () => {
    const { fetch, nextObserve } = makeFetch({ includeSource: true })
    state.body = { id: '1' }
    state.headers = { 'X-Schemind-Source': 'BookResponse@handlers/books.go:42' }
    await fetch(`${baseUrl}/api/meta/2`)
    const res = await nextObserve()
    state.headers = {}
    expect(res.observed.meta?.source).toBe('BookResponse@handlers/books.go:42')
  })

  it('does not observe responses over maxBodyBytes (Content-Length guard)', async () => {
    const { fetch, nextObserve } = makeFetch({ maxBodyBytes: 10 })
    state.body = { id: '1', title: 'a fairly long title that exceeds ten bytes' }
    await fetch(`${baseUrl}/api/big`)
    const sentinel = Symbol('pending')
    const winner = await Promise.race([
      nextObserve(),
      new Promise((r) => setTimeout(() => r(sentinel), 50)),
    ])
    expect(winner).toBe(sentinel)
  })

  it('does not observe when observeRate is 0 (sampling)', async () => {
    const { fetch, nextObserve } = makeFetch({ observeRate: 0 })
    state.body = { id: '1' }
    await fetch(`${baseUrl}/api/sampled`)
    const sentinel = Symbol('pending')
    const winner = await Promise.race([
      nextObserve(),
      new Promise((r) => setTimeout(() => r(sentinel), 50)),
    ])
    expect(winner).toBe(sentinel)
  })

  it('uses an injectable random for deterministic sampling (#8)', async () => {
    // random() returns 0.9 ≥ rate 0.5 → sampled out.
    const skip = makeFetch({ observeRate: 0.5, random: () => 0.9 })
    state.body = { id: '1' }
    await skip.fetch(`${baseUrl}/api/s1`)
    const sentinel = Symbol('pending')
    const winner = await Promise.race([
      skip.nextObserve(),
      new Promise((r) => setTimeout(() => r(sentinel), 50)),
    ])
    expect(winner).toBe(sentinel)

    // random() returns 0.1 < rate 0.5 → observed.
    const take = makeFetch({ observeRate: 0.5, random: () => 0.1 })
    await take.fetch(`${baseUrl}/api/s2`)
    expect((await take.nextObserve()).created).toBe(true)
  })

  it('skips unsized (chunked) bodies when skipUnsizedBodies is set (#6)', async () => {
    state.omitLength = true
    const { fetch, nextObserve } = makeFetch({ skipUnsizedBodies: true })
    state.body = { id: '1' }
    await fetch(`${baseUrl}/api/chunked`)
    state.omitLength = false
    const sentinel = Symbol('pending')
    const winner = await Promise.race([
      nextObserve(),
      new Promise((r) => setTimeout(() => r(sentinel), 50)),
    ])
    expect(winner).toBe(sentinel)
  })

  it('does not observe when disabled', async () => {
    const { fetch, nextObserve } = makeFetch({ enabled: false })
    state.body = { id: '1' }
    const res = await fetch(`${baseUrl}/api/books/1`)
    expect(res.status).toBe(200)
    // Nothing should observe; assert nextObserve stays pending past a tick.
    const sentinel = Symbol('pending')
    const winner = await Promise.race([
      nextObserve(),
      new Promise((r) => setTimeout(() => r(sentinel), 50)),
    ])
    expect(winner).toBe(sentinel)
  })

  it('ignores non-JSON responses', async () => {
    const { fetch, nextObserve } = makeFetch()
    state.contentType = 'text/plain'
    state.body = 'hello'
    await fetch(`${baseUrl}/api/text`)
    state.contentType = 'application/json'
    const sentinel = Symbol('pending')
    const winner = await Promise.race([
      nextObserve(),
      new Promise((r) => setTimeout(() => r(sentinel), 50)),
    ])
    expect(winner).toBe(sentinel)
  })
})
