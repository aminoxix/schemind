import type { ObserveResult, Schemind } from './engine.js'
import { highestSeverity } from './severity.js'
import type { DriftReport, Severity } from './types.js'

/** A single endpoint to probe during a scan. Matches `routes.json`. */
export interface ScanRoute {
  /** HTTP method. Default `GET`. */
  method?: string
  /** Path, optionally with `:param` placeholders, e.g. `/api/users/:id`. */
  path: string
  /** Values substituted into `:param` placeholders. */
  params?: Record<string, string>
  /** Query-string parameters. */
  query?: Record<string, string>
  /** Request body (sent as JSON). */
  body?: unknown
  /** Extra request headers. */
  headers?: Record<string, string>
}

/** Per-route outcome of a scan. */
export interface ScanRouteResult {
  method: string
  url: string
  endpoint: string | null
  status: number | null
  result: ObserveResult | null
  /** Set when the request itself failed (network/parse). */
  error?: string
}

/** Aggregate outcome of a scan. */
export interface ScanSummary {
  results: ScanRouteResult[]
  /** Drift reports that actually contained changes, in scan order. */
  reports: DriftReport[]
  /** Highest severity across all reports (`info` when none). */
  severity: Severity
  /** Endpoints seen for the first time (baseline created). */
  created: string[]
}

/** Options for {@link runScan}. */
export interface RunScanOptions {
  /** Target origin, e.g. `https://staging.api.com`. */
  baseUrl: string
  routes: ScanRoute[]
  /** Engine to observe responses with (owns the snapshot store + reporters). */
  engine: Schemind
  /** Fetch implementation. Defaults to `globalThis.fetch`. */
  fetch?: typeof globalThis.fetch
  /**
   * Skip observation when `Content-Length` exceeds this many bytes — avoids
   * OOM on a misbehaving endpoint returning a huge body. Default `1_000_000`
   * (1 MB). Set `0`/`Infinity` to disable.
   */
  maxBodyBytes?: number
  /**
   * Reject targets on loopback/private/link-local networks (SSRF hardening for
   * multi-tenant/CI-as-a-service). Default `false` so local dev (`localhost`)
   * works. Cloud-metadata addresses (169.254.169.254, …) are **always** blocked.
   */
  blockPrivateNetworks?: boolean
}

/**
 * Probe each route against `baseUrl`, observe the response shape, and collect
 * drift. The engine owns persistence and reporting; this just drives the HTTP
 * requests and aggregates results. Runtime-agnostic (needs only `fetch`).
 */
export async function runScan(options: RunScanOptions): Promise<ScanSummary> {
  const doFetch = options.fetch ?? globalThis.fetch
  const maxBodyBytes = options.maxBodyBytes ?? 1_000_000
  const blockPrivate = options.blockPrivateNetworks ?? false
  const results: ScanRouteResult[] = []
  const reports: DriftReport[] = []
  const created: string[] = []

  for (const route of options.routes) {
    const method = (route.method ?? 'GET').toUpperCase()
    const url = buildUrl(options.baseUrl, route)
    const entry: ScanRouteResult = { method, url, endpoint: null, status: null, result: null }

    try {
      assertSafeUrl(url, blockPrivate) // SSRF guard
      const res = await doFetch(url, buildInit(method, route))
      entry.status = res.status
      // Skip non-JSON responses — observing a text/html body would create a
      // scalar('string') baseline that drifts against a real JSON shape.
      if (!isJsonResponse(res)) {
        results.push(entry)
        continue
      }
      // Body-size guard — never parse a payload bigger than the cap.
      if (!withinSizeLimit(res.headers.get('content-length'), maxBodyBytes)) {
        entry.error = `response exceeds maxBodyBytes (${maxBodyBytes})`
        results.push(entry)
        continue
      }
      const body = await readBody(res)
      const result = await options.engine.observe({ method, url, statusCode: res.status, body })
      entry.endpoint = result.endpoint
      entry.result = result
      if (result.created) created.push(result.endpoint)
      if (result.report && result.report.changes.length > 0) reports.push(result.report)
    } catch (err) {
      entry.error = err instanceof Error ? err.message : String(err)
    }

    results.push(entry)
  }

  return { results, reports, severity: highestSeverity(reports.map((r) => r.severity)), created }
}

/* -------------------------------------------------------------------------- */

function buildUrl(baseUrl: string, route: ScanRoute): string {
  let path = route.path
  for (const [key, value] of Object.entries(route.params ?? {})) {
    path = path.replace(`:${key}`, encodeURIComponent(value))
  }
  const base = baseUrl.replace(/\/+$/, '')
  const url = new URL(`${base}${path.startsWith('/') ? path : `/${path}`}`)
  for (const [key, value] of Object.entries(route.query ?? {})) {
    url.searchParams.set(key, value)
  }
  return url.toString()
}

function buildInit(method: string, route: ScanRoute): RequestInit {
  const headers: Record<string, string> = { ...route.headers }
  const init: RequestInit = { method }
  if (route.body !== undefined) {
    headers['content-type'] = headers['content-type'] ?? 'application/json'
    init.body = JSON.stringify(route.body)
  }
  init.headers = headers
  return init
}

function isJsonResponse(res: Response): boolean {
  const ct = res.headers.get('content-type') ?? ''
  return /^[^;]*\/(?:[^;]+\+)?json\s*(?:;|$)/i.test(ct.trim())
}

function withinSizeLimit(contentLength: string | null, maxBytes: number): boolean {
  if (maxBytes <= 0 || !Number.isFinite(maxBytes)) return true
  if (contentLength === null) return true // chunked / unknown — can't cheaply guard
  const size = Number(contentLength)
  return !Number.isFinite(size) || size <= maxBytes
}

/** Cloud-metadata endpoints — never a legitimate scan target. Always blocked. */
const METADATA_HOSTS = new Set(['169.254.169.254', 'fd00:ec2::254', 'metadata.google.internal'])

function assertSafeUrl(rawUrl: string, blockPrivate: boolean): void {
  const host = new URL(rawUrl).hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (METADATA_HOSTS.has(host)) {
    throw new Error(`blocked cloud-metadata host: ${host}`)
  }
  if (blockPrivate && isPrivateHost(host)) {
    throw new Error(`blocked private/loopback host: ${host}`)
  }
}

function isPrivateHost(host: string): boolean {
  if (host === 'localhost') return true
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/)
  if (v4) {
    const a = Number(v4[1])
    const b = Number(v4[2])
    return (
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    )
  }
  // IPv6 loopback / link-local (fe80::/10) / unique-local (fc00::/7)
  return host === '::1' || host.startsWith('fe80') || host.startsWith('fc') || host.startsWith('fd')
}

async function readBody(res: Response): Promise<unknown> {
  try {
    return await res.json()
  } catch {
    return null
  }
}
