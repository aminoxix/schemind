import type { DriftReport, Reporter, Severity } from '../types.js'
import { warnIfHardcodedSecret } from './secrets.js'

type FetchFn = typeof globalThis.fetch

/** Configuration for {@link webhookReporter}. */
export interface WebhookReporterOptions {
  /** Destination URL — the drift report is POSTed here as JSON. */
  url: string
  /** Only notify for these severities. Default: all. */
  notifyOn?: readonly Severity[]
  /** Extra request headers (e.g. auth). */
  headers?: Record<string, string>
  /**
   * Shared secret. When set, the request carries
   * `X-Schemind-Signature: sha256=<hmac>` (HMAC-SHA256 of the JSON body) so the
   * receiver can verify the payload really came from schemind.
   */
  secret?: string
  /** Fetch implementation. Defaults to `globalThis.fetch`. */
  fetch?: FetchFn
}

/** POSTs each drift report (as JSON) to an arbitrary URL, optionally HMAC-signed. */
export function webhookReporter(options: WebhookReporterOptions): Reporter {
  warnIfHardcodedSecret(options.secret, 'webhook secret')
  return {
    name: 'webhook',
    async report(drift: DriftReport): Promise<void> {
      if (options.notifyOn && !options.notifyOn.includes(drift.severity)) return
      const doFetch = options.fetch ?? globalThis.fetch
      const body = JSON.stringify(drift)
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        ...options.headers,
      }
      if (options.secret) {
        headers['X-Schemind-Signature'] = `sha256=${await hmacSha256Hex(options.secret, body)}`
      }
      await doFetch(options.url, { method: 'POST', headers, body })
    },
  }
}

/** HMAC-SHA256 → lowercase hex, via Web Crypto (works in browser, edge and Node 18+). */
async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload))
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
