import { describe, expect, it } from 'vitest'
import { type ObserveResult, createSchemind } from '../src/engine.js'
import { createSchemindQueryClient, wrapQueryFn } from '../src/tanstack.js'

// Regression: the integration used to pass the endpoint *label* ("GET /api/books")
// into the `url` slot of engine.observe, which re-prepends the method via
// normalizeEndpoint — producing a mangled key like `GET /GET%20/api/books`.
// These tests pin the corrected, real endpoint keys.

describe('tanstack integration — endpoint keying', () => {
  it('wrapQueryFn observes under the real endpoint key, not a mangled label', async () => {
    const engine = createSchemind()
    const endpoint = await new Promise<string>((resolve) => {
      const fn = wrapQueryFn('GET /api/books', async () => ({ data: [] }), {
        engine,
        onObserve: (r) => resolve(r.endpoint),
      })
      void fn()
    })
    expect(endpoint).toBe('GET /api/books')
  })

  it('wrapQueryFn honors a non-GET method label', async () => {
    const engine = createSchemind()
    const endpoint = await new Promise<string>((resolve) => {
      const fn = wrapQueryFn('DELETE /api/books/42', async () => ({ ok: true }), {
        engine,
        method: 'DELETE',
        onObserve: (r) => resolve(r.endpoint),
      })
      void fn()
    })
    // `42` is collapsed to a param by the default normalization patterns.
    expect(endpoint).toBe('DELETE /api/books/:id')
  })

  it('tolerates a verb-prefixed label without a leading slash', async () => {
    const engine = createSchemind()
    const endpoint = await new Promise<string>((resolve) => {
      const fn = wrapQueryFn('GET books', async () => ({ data: [] }), {
        engine,
        onObserve: (r) => resolve(r.endpoint),
      })
      void fn()
    })
    expect(endpoint).toBe('GET /books')
  })

  it('falls back to the option method for a path-only label', async () => {
    const engine = createSchemind()
    const endpoint = await new Promise<string>((resolve) => {
      const fn = wrapQueryFn('/api/books', async () => ({ data: [] }), {
        engine,
        method: 'GET',
        onObserve: (r) => resolve(r.endpoint),
      })
      void fn()
    })
    expect(endpoint).toBe('GET /api/books')
  })

  it('createSchemindQueryClient auto-observes under the derived key', async () => {
    const engine = createSchemind()
    const endpoint = await new Promise<string>((resolve) => {
      const client = createSchemindQueryClient({ engine, onObserve: (r) => resolve(r.endpoint) })
      void client.fetchQuery({
        queryKey: ['GET', '/api/books'],
        queryFn: async () => ({ data: [] }),
      })
    })
    expect(endpoint).toBe('GET /api/books')
  })

  it('does not swallow a lowercase resource named like a verb', async () => {
    const engine = createSchemind()
    const endpoint = await new Promise<string>((resolve) => {
      const client = createSchemindQueryClient({ engine, onObserve: (r) => resolve(r.endpoint) })
      // `get` here is a resource name, not the HTTP verb — must not be dropped.
      void client.fetchQuery({ queryKey: ['get', 'config'], queryFn: async () => ({ ok: true }) })
    })
    expect(endpoint).toBe('GET /get/config')
  })

  it('treats an uppercase verb + bare resource as method + path', async () => {
    const engine = createSchemind()
    const endpoint = await new Promise<string>((resolve) => {
      const client = createSchemindQueryClient({ engine, onObserve: (r) => resolve(r.endpoint) })
      // `['GET', 'users']` (no leading slash) → `GET /users`, not `GET /GET/users`.
      void client.fetchQuery({ queryKey: ['GET', 'users'], queryFn: async () => ({ ok: true }) })
    })
    expect(endpoint).toBe('GET /users')
  })
})

describe('tanstack integration — statusCode + onError', () => {
  it('honors a statusCode override (non-2xx is gated as skipped)', async () => {
    const engine = createSchemind()
    const result = await new Promise<ObserveResult>((resolve) => {
      const fn = wrapQueryFn('GET /api/books', async () => ({ data: [] }), {
        engine,
        statusCode: 500,
        onObserve: resolve,
      })
      void fn()
    })
    expect(result.skipped).toBe(true)
  })

  it('observes (not skipped) with the default 200 status', async () => {
    const engine = createSchemind()
    const result = await new Promise<ObserveResult>((resolve) => {
      const fn = wrapQueryFn('GET /api/books', async () => ({ data: [] }), {
        engine,
        onObserve: resolve,
      })
      void fn()
    })
    expect(result.skipped).toBe(false)
  })

  it('routes observation failures to onError instead of swallowing them', async () => {
    const engine = createSchemind()
    // Force the observe step to reject so the onError path is exercised.
    engine.observe = () => Promise.reject(new Error('boom'))
    const error = await new Promise<unknown>((resolve) => {
      const fn = wrapQueryFn('GET /api/books', async () => ({ data: [] }), {
        engine,
        onError: resolve,
      })
      void fn()
    })
    expect((error as Error).message).toBe('boom')
  })
})
