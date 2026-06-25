import { type Server, createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createSchemind } from '../src/engine.js'
import { extractShape } from '../src/extractor.js'
import { createFixture } from '../src/fixture.js'
import { type ScanRoute, runScan } from '../src/scan.js'
import { MemoryStorageDriver, SnapshotStore } from '../src/snapshot.js'

const state: { body: unknown; status: number } = { body: {}, status: 200 }
let server: Server
let baseUrl: string

beforeAll(async () => {
  server = createServer((_req, res) => {
    const payload = JSON.stringify(state.body)
    res.writeHead(state.status, {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(payload),
    })
    res.end(payload)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())))
})

const routes: ScanRoute[] = [
  { method: 'GET', path: '/api/books' },
  { method: 'GET', path: '/api/books/:id', params: { id: '1' } },
]

describe('runScan', () => {
  it('learns baselines on first run, no drift', async () => {
    const engine = createSchemind({ includeOrigin: false })
    state.body = { data: [{ id: 1, title: 'A' }], count: 1 }
    const summary = await runScan({ baseUrl, routes, engine })

    expect(summary.severity).toBe('info')
    expect(summary.reports).toEqual([])
    expect(summary.created.sort()).toEqual(['GET /api/books', 'GET /api/books/:id'])
    // :id route was substituted with 1 but normalized back to :id
    expect(summary.results[1]?.url).toMatch(/\/api\/books\/1$/)
    expect(summary.results[1]?.endpoint).toBe('GET /api/books/:id')
  })

  it('detects breaking drift on a later run', async () => {
    const engine = createSchemind({ includeOrigin: false })
    state.body = { data: [{ id: 1, title: 'A' }], count: 1 }
    await runScan({ baseUrl, routes, engine }) // baseline

    state.body = { data: [{ id: 1, name: 'A' }], count: 1 } // title -> name
    const summary = await runScan({ baseUrl, routes, engine })

    expect(summary.severity).toBe('breaking')
    expect(summary.reports.length).toBeGreaterThanOrEqual(1)
    const paths = summary.reports.flatMap((r) => r.changes.map((c) => c.type))
    expect(paths).toContain('field_removed')
    expect(paths).toContain('field_added')
  })

  it('replays a recorded fixture against a target and detects drift (F10)', async () => {
    // Record a baseline shape into a portable fixture.
    const fixture = createFixture([
      {
        endpoint: 'GET /api/books',
        shape: extractShape({ data: [{ id: 1, title: 'A' }], count: 1 }),
      },
    ])
    // Seed an engine from the fixture, then scan a *changed* target.
    const store = new SnapshotStore(new MemoryStorageDriver())
    for (const [endpoint, shape] of Object.entries(fixture.shapes))
      await store.commit(endpoint, shape)
    const engine = createSchemind({ includeOrigin: false, store })

    state.body = { data: [{ id: 1, name: 'A' }], count: 1 } // title -> name
    const summary = await runScan({ baseUrl, routes: [{ path: '/api/books' }], engine })
    expect(summary.severity).toBe('breaking')
  })

  it('blocks cloud-metadata hosts — SSRF guard (#4)', async () => {
    const engine = createSchemind({ includeOrigin: false })
    const summary = await runScan({
      baseUrl: 'http://169.254.169.254',
      routes: [{ path: '/latest/meta-data/' }],
      engine,
    })
    expect(summary.results[0]?.error).toMatch(/metadata/)
    expect(summary.results[0]?.result).toBeNull()
  })

  it('blocks private/loopback hosts when blockPrivateNetworks is set', async () => {
    const engine = createSchemind({ includeOrigin: false })
    const summary = await runScan({
      baseUrl, // 127.0.0.1
      routes: [{ path: '/api/books' }],
      engine,
      blockPrivateNetworks: true,
    })
    expect(summary.results[0]?.error).toMatch(/private|loopback/)
  })

  it('skips responses over maxBodyBytes (#1)', async () => {
    const engine = createSchemind({ includeOrigin: false })
    state.body = { big: 'x'.repeat(5000) }
    const summary = await runScan({
      baseUrl,
      routes: [{ path: '/api/books' }],
      engine,
      maxBodyBytes: 100,
    })
    expect(summary.results[0]?.error).toMatch(/maxBodyBytes/)
    expect(summary.results[0]?.result).toBeNull()
  })

  it('records request errors without throwing', async () => {
    const engine = createSchemind({ includeOrigin: false })
    const summary = await runScan({
      baseUrl: 'http://127.0.0.1:1', // nothing listening
      routes: [{ path: '/x' }],
      engine,
    })
    expect(summary.results[0]?.error).toBeTruthy()
    expect(summary.results[0]?.result).toBeNull()
  })
})
