import { timingSafeEqual } from 'node:crypto'
import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http'
import { createSchemind } from './engine.js'
import { endpointHealth } from './health.js'
import { type ScanRoute, runScan } from './scan.js'
import type { SnapshotStore } from './snapshot.js'
import type { DriftReport, ShapeNode } from './types.js'

/** Options for {@link startDashboard}. */
export interface DashboardOptions {
  store: SnapshotStore
  /** Port to listen on. Default `4500`. */
  port?: number
  /** Host to bind. Default `127.0.0.1`. */
  host?: string
  /** Target for the in-dashboard "Scan now" button. */
  baseUrl?: string
  /** Routes to scan. */
  routes?: ScanRoute[]
  /** Endpoint-key origin handling — match your scan config. Default `false`. */
  includeOrigin?: boolean
  /**
   * Bearer token gating all mutating (non-GET) requests — scan and accept. When
   * set, the page must be opened with `#token=<token>` and requests carry
   * `Authorization: Bearer <token>`. Strongly recommended for any non-loopback bind.
   */
  token?: string
}

/** A running dashboard handle. */
export interface DashboardHandle {
  url: string
  server: Server
  close: () => Promise<void>
}

/**
 * Serve a local web UI for the snapshot store: every endpoint with its health
 * score and acceptance trail, a one-click **Scan now**, and per-endpoint
 * **Accept** buttons that stamp the audit trail. Zero-dependency (`node:http`).
 */
export function startDashboard(options: DashboardOptions): DashboardHandle {
  const { store } = options
  const host = options.host ?? '127.0.0.1'
  const port = options.port ?? 4500
  // Observed shapes from the most recent scan, kept so "Accept" can commit them.
  const pending = new Map<string, ShapeNode>()

  const server = createServer((req, res) => {
    handle(req, res).catch((err) => json(res, 500, { error: String(err) }))
  })

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${host}:${port}`)
    const path = url.pathname

    // Auth: when a token is set, every endpoint except the static page requires
    // it — so endpoint names + health (a GET) don't leak off-loopback either.
    if (options.token && path !== '/' && !authorized(req, options.token)) {
      json(res, 401, { error: 'unauthorized' })
      return
    }

    if (req.method === 'GET' && path === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(PAGE)
      return
    }

    if (req.method === 'GET' && path === '/api/endpoints') {
      const endpoints = await Promise.all(
        (await store.list()).map(async (endpoint) => {
          const snap = await store.load(endpoint)
          return snap
            ? { ...endpointHealth(snap), pending: pending.has(endpoint) }
            : {
                endpoint,
                score: 0,
                version: 0,
                changes: 0,
                ageDays: 0,
                changesPerWeek: 0,
                pending: false,
              }
        }),
      )
      endpoints.sort((a, b) => a.score - b.score)
      json(res, 200, { endpoints, canScan: Boolean(options.baseUrl && options.routes?.length) })
      return
    }

    if (req.method === 'POST' && path === '/api/scan') {
      if (!options.baseUrl || !options.routes?.length) {
        json(res, 400, { error: 'no baseUrl/routes configured' })
        return
      }
      const engine = createSchemind({ store, includeOrigin: options.includeOrigin ?? false })
      const summary = await runScan({ baseUrl: options.baseUrl, routes: options.routes, engine })
      pending.clear()
      const drifts: Array<DriftReport & { canAccept: boolean }> = []
      for (const r of summary.results) {
        if (r.result?.report && r.result.report.changes.length > 0) {
          pending.set(r.result.endpoint, r.result.observed.shape)
          drifts.push({ ...r.result.report, canAccept: true })
        }
      }
      json(res, 200, { drifts, severity: summary.severity })
      return
    }

    if (req.method === 'POST' && path === '/api/accept') {
      const body = (await readJson(req)) as {
        endpoint?: string
        acceptedBy?: string
        reason?: string
      }
      const shape = body.endpoint ? pending.get(body.endpoint) : undefined
      if (!body.endpoint || !shape) {
        json(res, 400, { error: 'no pending drift for that endpoint — scan first' })
        return
      }
      await store.commit(body.endpoint, shape, {
        acceptance: {
          acceptedBy: body.acceptedBy ?? 'dashboard',
          ...(body.reason ? { reason: body.reason } : {}),
        },
      })
      pending.delete(body.endpoint)
      json(res, 200, { accepted: body.endpoint })
      return
    }

    json(res, 404, { error: 'not found' })
  }

  server.listen(port, host)
  const url = `http://${host}:${port}`
  return {
    url,
    server,
    close: () => new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

/** Constant-time bearer-token check on the Authorization header. */
function authorized(req: IncomingMessage, token: string): boolean {
  const got = Buffer.from(req.headers.authorization ?? '')
  const want = Buffer.from(`Bearer ${token}`)
  return got.length === want.length && timingSafeEqual(got, want)
}

const MAX_BODY_BYTES = 65_536 // 64 KB — the dashboard only ever receives tiny JSON

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buf = chunk as Buffer
    total += buf.length
    if (total > MAX_BODY_BYTES) throw new Error('request body too large')
    chunks.push(buf)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>schemind dashboard</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 14px/1.5 ui-sans-serif,system-ui,sans-serif; margin: 0; background:#f4f4f5; color:#18181b; }
  header { background:#18181b; color:#fff; padding:14px 24px; display:flex; align-items:center; gap:10px; }
  header b { font-size:15px } header span { color:#a1a1aa; font-size:12px }
  main { max-width:980px; margin:24px auto; padding:0 20px; }
  .row { display:flex; gap:10px; align-items:center; margin-bottom:16px; flex-wrap:wrap }
  button { background:#18181b; color:#fff; border:0; border-radius:8px; padding:8px 12px; font-size:13px; cursor:pointer }
  button.ghost { background:#fff; color:#3f3f46; border:1px solid #e4e4e7 }
  table { width:100%; border-collapse:collapse; background:#fff; border:1px solid #e4e4e7; border-radius:12px; overflow:hidden }
  th,td { text-align:left; padding:9px 12px; border-bottom:1px solid #f4f4f5; font-size:13px }
  th { color:#71717a; font-weight:600; font-size:11px; text-transform:uppercase; letter-spacing:.04em }
  code { font-family:ui-monospace,monospace; font-size:12px }
  .pill { padding:1px 8px; border-radius:999px; font-size:11px; font-weight:600 }
  .s-hi { background:#dcfce7; color:#166534 } .s-md { background:#fef9c3; color:#854d0e } .s-lo { background:#fee2e2; color:#991b1b }
  .sev-breaking { color:#dc2626 } .sev-warn { color:#ca8a04 } .sev-info { color:#2563eb }
  .drift { background:#fff; border:1px solid #e4e4e7; border-radius:12px; padding:14px; margin-top:10px }
  .muted { color:#a1a1aa }
</style></head>
<body>
<header><b>schemind</b><span>API shape dashboard</span></header>
<main>
  <div class="row">
    <button id="scan">Scan now</button>
    <button class="ghost" id="refresh">Refresh</button>
    <span id="status" class="muted"></span>
  </div>
  <table><thead><tr><th>score</th><th>endpoint</th><th>v</th><th>changes</th><th>accepted by</th></tr></thead>
  <tbody id="rows"></tbody></table>
  <div id="drifts"></div>
</main>
<script>
const $ = (s) => document.querySelector(s)
// Escape ALL server-derived strings — endpoint keys / paths / acceptedBy come from
// observed JSON and could contain HTML (stored-XSS guard).
const esc = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
const sev = (s) => '<span class="sev-'+esc(s)+'">'+esc(s)+'</span>'
const scoreClass = (n) => n>=70?'s-hi':n>=40?'s-md':'s-lo'
const TOKEN = new URLSearchParams(location.hash.slice(1)).get('token') || ''
const authHeaders = TOKEN ? { authorization: 'Bearer '+TOKEN } : {}
async function load() {
  const r = await fetch('/api/endpoints',{headers:authHeaders}).then(x=>x.json())
  $('#scan').style.display = r.canScan ? '' : 'none'
  $('#rows').innerHTML = r.endpoints.map(e => '<tr><td><span class="pill '+scoreClass(e.score)+'">'+esc(e.score)+'</span></td>'
    +'<td><code>'+esc(e.endpoint)+'</code></td><td>'+esc(e.version)+'</td><td>'+esc(e.changes)+'</td>'
    +'<td class="muted">'+esc(e.lastAcceptance? (e.lastAcceptance.acceptedBy||'—'):'—')+'</td></tr>').join('')
}
async function scan() {
  $('#status').textContent = 'scanning…'
  const r = await fetch('/api/scan',{method:'POST',headers:authHeaders}).then(x=>x.json())
  if (r.error) { $('#status').textContent = r.error; return }
  $('#status').textContent = r.drifts.length+' drifted · highest '+r.severity
  $('#drifts').innerHTML = r.drifts.map(d => '<div class="drift"><b>'+sev(d.severity)+'</b> <code>'+esc(d.endpoint)+'</code>'
    + ' <button data-ep="'+encodeURIComponent(d.endpoint)+'">Accept</button>'
    + '<ul>'+d.changes.map(c=>'<li><code>'+esc(c.path||'(root)')+'</code> · '+esc(c.type)+' · '+sev(c.severity)+'</li>').join('')+'</ul></div>').join('')
  document.querySelectorAll('#drifts button').forEach(b => b.onclick = () => accept(decodeURIComponent(b.dataset.ep)))
}
async function accept(endpoint) {
  await fetch('/api/accept',{method:'POST',headers:{'content-type':'application/json',...authHeaders},body:JSON.stringify({endpoint})})
  await scan(); await load()
}
$('#scan').onclick = scan
$('#refresh').onclick = load
load()
</script>
</body></html>`
