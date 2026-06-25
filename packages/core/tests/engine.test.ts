import { describe, expect, it, vi } from 'vitest'
import { createSchemind } from '../src/engine.js'
import type { Reporter } from '../src/types.js'

const fixedClock = () => '2026-01-01T00:00:00.000Z'

describe('Schemind.observe', () => {
  it('creates a baseline on first sight (no report)', async () => {
    const engine = createSchemind({ now: fixedClock })
    const res = await engine.observe({
      method: 'GET',
      url: 'http://localhost:8080/api/books/1',
      statusCode: 200,
      body: { id: '1', title: 'A', rating: 4.5 },
    })
    expect(res.created).toBe(true)
    expect(res.report).toBeNull()
    expect(res.endpoint).toBe('GET http://localhost:8080/api/books/:id')
    expect(await engine.getStore().list()).toEqual(['GET http://localhost:8080/api/books/:id'])
  })

  it('normalizes distinct ids to one endpoint and detects no drift for equal shapes', async () => {
    const engine = createSchemind({ now: fixedClock })
    await engine.observe({ method: 'GET', url: '/api/books/1', statusCode: 200, body: { id: '1' } })
    const res = await engine.observe({
      method: 'GET',
      url: '/api/books/2',
      statusCode: 200,
      body: { id: '2' },
    })
    expect(res.created).toBe(false)
    expect(res.report?.changes).toEqual([])
    expect(res.report?.severity).toBe('info')
  })

  it('detects a breaking change and fires reporters', async () => {
    const report = vi.fn().mockResolvedValue(undefined)
    const reporter: Reporter = { name: 'spy', report }
    const engine = createSchemind({ now: fixedClock, reporters: [reporter] })

    await engine.observe({
      method: 'GET',
      url: '/api/books/1',
      statusCode: 200,
      body: { id: '1', author: 'Anshumaan' },
    })
    const res = await engine.observe({
      method: 'GET',
      url: '/api/books/2',
      statusCode: 200,
      body: { id: '2', authorInfo: 'Anshumaan' }, // author renamed → removed + added
    })

    expect(res.report?.severity).toBe('breaking')
    expect(res.report?.changes.map((c) => c.type).sort()).toEqual(['field_added', 'field_removed'])
    expect(report).toHaveBeenCalledOnce()
  })

  it('does not fire reporters for additive-only (info) drift but still reports it', async () => {
    const report = vi.fn().mockResolvedValue(undefined)
    const engine = createSchemind({ now: fixedClock, reporters: [{ name: 'spy', report }] })
    await engine.observe({ method: 'GET', url: '/api/x', statusCode: 200, body: { a: 1 } })
    const res = await engine.observe({
      method: 'GET',
      url: '/api/x',
      statusCode: 200,
      body: { a: 1, b: 2 },
    })
    // info IS a change, so reporters fire (they decide filtering); severity is info.
    expect(res.report?.severity).toBe('info')
    expect(report).toHaveBeenCalledOnce()
  })

  it('keeps drift visible by default (does not advance the baseline)', async () => {
    const engine = createSchemind({ now: fixedClock })
    await engine.observe({ method: 'GET', url: '/api/x', statusCode: 200, body: { a: 'x' } })
    const first = await engine.observe({
      method: 'GET',
      url: '/api/x',
      statusCode: 200,
      body: { a: 1 },
    })
    const second = await engine.observe({
      method: 'GET',
      url: '/api/x',
      statusCode: 200,
      body: { a: 1 },
    })
    expect(first.report?.severity).toBe('breaking')
    expect(second.report?.severity).toBe('breaking') // still reported, baseline unchanged
  })

  it('advances the baseline when updateOnDrift is set', async () => {
    const engine = createSchemind({ now: fixedClock, updateOnDrift: true })
    await engine.observe({ method: 'GET', url: '/api/x', statusCode: 200, body: { a: 'x' } })
    await engine.observe({ method: 'GET', url: '/api/x', statusCode: 200, body: { a: 1 } })
    const third = await engine.observe({
      method: 'GET',
      url: '/api/x',
      statusCode: 200,
      body: { a: 1 },
    })
    expect(third.report?.changes).toEqual([]) // baseline moved to {a:number}
  })

  it('does not learn error (non-2xx) responses against the success baseline', async () => {
    const engine = createSchemind({ now: fixedClock })
    // Success baseline.
    await engine.observe({
      method: 'GET',
      url: '/api/books/1',
      statusCode: 200,
      body: { id: '1', title: 'A' },
    })
    // A 404 with a completely different error shape must be skipped, not diffed.
    const err = await engine.observe({
      method: 'GET',
      url: '/api/books/999',
      statusCode: 404,
      body: { error: 'not found', code: 404 },
    })
    expect(err.skipped).toBe(true)
    expect(err.report).toBeNull()
    expect(err.created).toBe(false)

    // Baseline is intact: a later success with the original shape shows no drift.
    const ok = await engine.observe({
      method: 'GET',
      url: '/api/books/2',
      statusCode: 200,
      body: { id: '2', title: 'B' },
    })
    expect(ok.report?.changes).toEqual([])
  })

  it('tracks request-body shape under a separate baseline (#6)', async () => {
    const engine = createSchemind({ now: fixedClock, includeOrigin: false })
    await engine.observe({
      method: 'POST',
      url: '/api/login',
      statusCode: 200,
      body: { token: 't' },
      requestBody: { email: 'a', password: 'b' },
    })
    const res = await engine.observe({
      method: 'POST',
      url: '/api/login',
      statusCode: 200,
      body: { token: 't' },
      requestBody: { email: 'a' }, // password removed from the request contract
    })
    expect(res.report?.changes).toEqual([]) // response unchanged
    expect(res.requestReport?.severity).toBe('breaking')
    expect(res.requestReport?.changes[0]?.type).toBe('field_removed')
    expect(await engine.getStore().list()).toContain('POST /api/login [request]')
  })

  it('honors a custom shouldObserve predicate', async () => {
    const engine = createSchemind({ now: fixedClock, shouldObserve: () => false })
    const res = await engine.observe({
      method: 'GET',
      url: '/api/x',
      statusCode: 200,
      body: { a: 1 },
    })
    expect(res.skipped).toBe(true)
    expect(await engine.getStore().list()).toEqual([])
  })

  it('keeps different hosts in separate baselines (no cross-host false drift)', async () => {
    const engine = createSchemind({ now: fixedClock })
    await engine.observe({
      method: 'GET',
      url: 'https://a.com/api/x',
      statusCode: 200,
      body: { a: 'str' },
    })
    const res = await engine.observe({
      method: 'GET',
      url: 'https://b.com/api/x',
      statusCode: 200,
      body: { a: 1 }, // different shape, but different host → its own baseline
    })
    expect(res.created).toBe(true)
    expect(res.report).toBeNull()
    expect((await engine.getStore().list()).sort()).toEqual([
      'GET https://a.com/api/x',
      'GET https://b.com/api/x',
    ])
  })

  it('serializes concurrent observations of the same endpoint (no race)', async () => {
    const engine = createSchemind({ now: fixedClock })
    // Fire many identical first-time observations concurrently.
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        engine.observe({ method: 'GET', url: '/api/race', statusCode: 200, body: { a: 1 } }),
      ),
    )
    // Exactly one creates the baseline; the rest see it (no duplicate version bumps).
    expect(results.filter((r) => r.created)).toHaveLength(1)
    const snap = await engine.getStore().load('GET /api/race')
    expect(snap?.snapshotVersion).toBe(1)
    expect(snap?.history).toEqual([])
  })

  it('does not bump snapshotVersion for a hash-only change (same shape)', async () => {
    const engine = createSchemind({ now: fixedClock })
    await engine.observe({
      method: 'GET',
      url: '/api/x',
      statusCode: 200,
      body: { a: 1 },
      meta: { schemaHash: 'aaaaaaaa' },
    })
    await engine.observe({
      method: 'GET',
      url: '/api/x',
      statusCode: 200,
      body: { a: 1 }, // identical shape, new hash
      meta: { schemaHash: 'bbbbbbbb' },
    })
    const snap = await engine.getStore().load('GET /api/x')
    expect(snap?.snapshotVersion).toBe(1)
    expect(snap?.history).toEqual([])
    expect(snap?.hash).toBe('bbbbbbbb')
  })

  it('ignores a malformed adapter hash (must not suppress drift)', async () => {
    const engine = createSchemind({ now: fixedClock, trustAdapterHash: true })
    await engine.observe({
      method: 'GET',
      url: '/api/x',
      statusCode: 200,
      body: { a: 'x' },
      meta: { schemaHash: '1' }, // bogus — not 8-hex
    })
    const baseline = await engine.getStore().load('GET /api/x')
    expect(baseline?.hash).toBeUndefined() // not stored

    const res = await engine.observe({
      method: 'GET',
      url: '/api/x',
      statusCode: 200,
      body: { a: 1 }, // really changed — a spoofed "1" hash must not hide it
      meta: { schemaHash: '1' },
    })
    expect(res.skipped).toBe(false)
    expect(res.report?.severity).toBe('breaking')
  })

  it('honors the adapter hash fast-path when trustAdapterHash is enabled', async () => {
    const engine = createSchemind({ now: fixedClock, trustAdapterHash: true })
    await engine.observe({
      method: 'GET',
      url: '/api/x',
      statusCode: 200,
      body: { a: 'x' },
      meta: { schemaHash: 'a3f9b2c1' },
    })
    const res = await engine.observe({
      method: 'GET',
      url: '/api/x',
      statusCode: 200,
      body: { a: 1, b: 2, totallyDifferent: true }, // would be breaking — but hash matches
      meta: { schemaHash: 'a3f9b2c1' },
    })
    expect(res.skipped).toBe(true)
    expect(res.report).toBeNull()
  })

  it('ignores the adapter hash by default (does not trust attacker-controlled headers)', async () => {
    const engine = createSchemind({ now: fixedClock }) // trustAdapterHash defaults false
    await engine.observe({
      method: 'GET',
      url: '/api/x',
      statusCode: 200,
      body: { a: 'x' },
      meta: { schemaHash: 'a3f9b2c1' },
    })
    const res = await engine.observe({
      method: 'GET',
      url: '/api/x',
      statusCode: 200,
      body: { a: 1 }, // really changed — a spoofed matching hash must not hide it
      meta: { schemaHash: 'a3f9b2c1' },
    })
    expect(res.skipped).toBe(false)
    expect(res.report?.severity).toBe('breaking')
  })
})
