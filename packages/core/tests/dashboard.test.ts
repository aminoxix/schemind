import { type Server, createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type DashboardHandle, startDashboard } from '../src/dashboard.js'
import { extractShape } from '../src/extractor.js'
import { MemoryStorageDriver, SnapshotStore } from '../src/snapshot.js'

const targetState = { body: {} as unknown }
let target: Server
let targetUrl: string
let dash: DashboardHandle
let dashUrl: string
let store: SnapshotStore

beforeAll(async () => {
  target = createServer((_req, res) => {
    const payload = JSON.stringify(targetState.body)
    res.writeHead(200, {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(payload),
    })
    res.end(payload)
  })
  await new Promise<void>((r) => target.listen(0, '127.0.0.1', r))
  targetUrl = `http://127.0.0.1:${(target.address() as AddressInfo).port}`

  store = new SnapshotStore(new MemoryStorageDriver())
  // Existing baseline: { data: [{ id, title }], count }
  await store.commit('GET /api/books', extractShape({ data: [{ id: 1, title: 'A' }], count: 1 }))

  dash = startDashboard({
    store,
    port: 0,
    baseUrl: targetUrl,
    routes: [{ path: '/api/books' }],
    includeOrigin: false,
  })
  await new Promise<void>((res) => {
    if (dash.server.listening) res()
    else dash.server.once('listening', () => res())
  })
  dashUrl = `http://127.0.0.1:${(dash.server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await dash.close()
  await new Promise<void>((resolve, reject) => target.close((e) => (e ? reject(e) : resolve())))
})

describe('schm dashboard', () => {
  it('serves the HTML page', async () => {
    const html = await (await fetch(`${dashUrl}/`)).text()
    expect(html).toContain('schemind')
    expect(html).toContain('Scan now')
  })

  it('escapes server-derived strings in the page (stored-XSS guard #18)', async () => {
    const html = await (await fetch(`${dashUrl}/`)).text()
    expect(html).toContain('const esc =')
    // server data flows through esc(), not raw concatenation
    expect(html).toContain('esc(e.endpoint)')
    expect(html).toContain('esc(d.endpoint)')
    expect(html).toContain("esc(c.path||'(root)')")
    expect(html).not.toContain("'+e.endpoint+'")
    expect(html).not.toContain("'+d.endpoint+'")
  })

  it('lists endpoints with health + canScan', async () => {
    const data = (await (await fetch(`${dashUrl}/api/endpoints`)).json()) as {
      endpoints: Array<{ endpoint: string; score: number }>
      canScan: boolean
    }
    expect(data.canScan).toBe(true)
    expect(data.endpoints[0]?.endpoint).toBe('GET /api/books')
    expect(data.endpoints[0]?.score).toBe(100)
  })

  it('scans, surfaces drift, and accepts it (advancing the baseline)', async () => {
    targetState.body = { data: [{ id: 1, name: 'A' }], count: 1 } // title → name (breaking)
    const scan = (await (await fetch(`${dashUrl}/api/scan`, { method: 'POST' })).json()) as {
      drifts: Array<{ endpoint: string; severity: string }>
      severity: string
    }
    expect(scan.severity).toBe('breaking')
    expect(scan.drifts[0]?.endpoint).toBe('GET /api/books')

    const accept = await fetch(`${dashUrl}/api/accept`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: 'GET /api/books', acceptedBy: 'tester' }),
    })
    expect(accept.status).toBe(200)

    const snap = await store.load('GET /api/books')
    expect(snap?.snapshotVersion).toBe(2) // baseline advanced
    expect(snap?.acceptance?.acceptedBy).toBe('tester')
  })
})

describe('dashboard auth (#1)', () => {
  it('gates mutating requests behind the bearer token', async () => {
    const h = startDashboard({
      store: new SnapshotStore(new MemoryStorageDriver()),
      port: 0,
      token: 'sekret',
    })
    await new Promise<void>((res) => {
      if (h.server.listening) res()
      else h.server.once('listening', () => res())
    })
    const base = `http://127.0.0.1:${(h.server.address() as AddressInfo).port}`
    try {
      expect((await fetch(`${base}/`)).status).toBe(200) // static page stays open
      // GET data endpoint is gated when a token is set (no off-loopback leak).
      expect((await fetch(`${base}/api/endpoints`)).status).toBe(401)
      const authedGet = await fetch(`${base}/api/endpoints`, {
        headers: { authorization: 'Bearer sekret' },
      })
      expect(authedGet.status).toBe(200)

      expect((await fetch(`${base}/api/scan`, { method: 'POST' })).status).toBe(401) // no token
      const wrong = await fetch(`${base}/api/scan`, {
        method: 'POST',
        headers: { authorization: 'Bearer nope' },
      })
      expect(wrong.status).toBe(401)
      const ok = await fetch(`${base}/api/scan`, {
        method: 'POST',
        headers: { authorization: 'Bearer sekret' },
      })
      expect(ok.status).not.toBe(401) // authorized (400: no baseUrl configured)
    } finally {
      await h.close()
    }
  })
})
