import {
  type ObserveResult,
  type Schemind,
  type SchemindOptions,
  createSchemind,
} from './engine.js'
import type { AdapterMeta } from './types.js'
import { isValidSchemaHash } from './validate.js'

type FetchFn = typeof globalThis.fetch
type FetchInput = Parameters<FetchFn>[0]
type FetchInit = Parameters<FetchFn>[1]

/** Options for {@link createSchemindFetch}. Extends {@link SchemindOptions} so an engine can be configured inline. */
export interface SchemindFetchOptions extends SchemindOptions {
  /** A pre-built engine. When omitted, one is created from the remaining options. */
  engine?: Schemind
  /** Underlying fetch implementation. Defaults to `globalThis.fetch` at call time. */
  fetch?: FetchFn
  /**
   * Master switch. Defaults to `true` unless `SCHEMIND_ENABLED=false` is set in
   * the environment — mirroring the production kill-switch from the docs.
   */
  enabled?: boolean
  /** Called (after the response is returned to the caller) with every observation. */
  onObserve?: (result: ObserveResult) => void
  /** Called if shape extraction/observation fails. Observation errors never surface to the caller. */
  onError?: (error: unknown) => void
  /**
   * Fraction of eligible responses to observe, `0`–`1`. Use to sample on a
   * high-traffic API so observation isn't a per-request cost. Default `1`
   * (observe everything).
   */
  observeRate?: number
  /**
   * Skip observation when the response's `Content-Length` exceeds this many
   * bytes — avoids cloning/parsing huge payloads (exports, data dumps). Default
   * `1_000_000` (1 MB). Set `0`/`Infinity` to disable. Responses without a
   * `Content-Length` (chunked) are not size-guarded.
   */
  maxBodyBytes?: number
  /**
   * Read the `X-Schemind-Source` header (backend `file:line`) into observation
   * meta. **Default `false`** — keeps internal source paths out of your logs and
   * reporters unless you explicitly want them in dev/staging.
   */
  includeSource?: boolean
  /**
   * Skip observing responses without a `Content-Length` (chunked) — they can't
   * be size-guarded before cloning, so this avoids the memory spike under load.
   * Default `false`.
   */
  skipUnsizedBodies?: boolean
  /**
   * RNG for {@link observeRate} sampling. Defaults to `Math.random`; inject a
   * seeded source to make sampling deterministic in tests.
   */
  random?: () => number
}

let warnedSourceInProd = false

/**
 * Wrap `fetch` so every JSON response is observed for shape drift.
 *
 * The wrapper is a faithful drop-in: it returns the **original** response
 * immediately and performs shape extraction asynchronously on a clone, so it
 * never delays or alters the data the caller receives.
 *
 * ```ts
 * import { createSchemindFetch } from 'schemind'
 * const fetch = createSchemindFetch({ onObserve: (r) => r.report && console.log(r.report) })
 * ```
 */
export function createSchemindFetch(options: SchemindFetchOptions = {}): FetchFn {
  const engine = options.engine ?? createSchemind(options)
  const enabled = options.enabled ?? defaultEnabled()
  const observeRate = clampRate(options.observeRate)
  const maxBodyBytes = options.maxBodyBytes ?? 1_000_000
  const includeSource = options.includeSource ?? false
  const skipUnsized = options.skipUnsizedBodies ?? false
  const random = options.random ?? Math.random

  if (includeSource && isProduction() && !warnedSourceInProd) {
    warnedSourceInProd = true
    console.warn(
      '[schemind] includeSource is enabled in production — backend source paths (X-Schemind-Source) may reach logs/reporters.',
    )
  }

  const wrapped = async (input: FetchInput, init?: FetchInit): Promise<Response> => {
    const baseFetch = options.fetch ?? globalThis.fetch
    const response = await baseFetch(input, init)
    if (!enabled) return response

    try {
      // Only JSON bodies carry a meaningful shape; skip the rest at zero cost.
      // Size + sampling are checked *before* clone(), so a huge or sampled-out
      // body is never duplicated in memory.
      if (
        response.body &&
        isJsonContentType(response.headers.get('content-type')) &&
        sampled(observeRate, random) &&
        withinSizeLimit(response.headers.get('content-length'), maxBodyBytes, skipUnsized)
      ) {
        const clone = response.clone()
        const { method, url } = describeRequest(input, init, response)
        const meta = readAdapterMeta(response.headers, includeSource)

        // Fire-and-forget: never awaited before returning `response`.
        void clone
          .json()
          .then((body) =>
            engine.observe({
              method,
              url,
              statusCode: response.status,
              body,
              ...(meta !== undefined ? { meta } : {}),
            }),
          )
          .then((result) => options.onObserve?.(result))
          .catch((error) => options.onError?.(error))
      }
    } catch (error) {
      options.onError?.(error)
    }

    return response
  }

  return wrapped as FetchFn
}

/**
 * A ready-to-use schemind-instrumented `fetch`, backed by a default in-memory
 * engine. For UI integration or custom stores, prefer {@link createSchemindFetch}.
 */
export const fetch: FetchFn = createSchemindFetch()

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function describeRequest(
  input: FetchInput,
  init: FetchInit | undefined,
  response: Response,
): { method: string; url: string } {
  const isRequest = typeof Request !== 'undefined' && input instanceof Request
  const method = init?.method ?? (isRequest ? (input as Request).method : 'GET')
  // `response.url` is the final (post-redirect) URL and is the most reliable.
  const url =
    response.url ||
    (isRequest ? (input as Request).url : input instanceof URL ? input.href : String(input))
  return { method, url }
}

function readAdapterMeta(headers: Headers, includeSource: boolean): AdapterMeta | undefined {
  const hash = headers.get('X-Schemind-Schema-Hash')
  const versionRaw = headers.get('X-Schemind-Schema-Version')
  // Source paths are read only when explicitly opted in (avoids leaking internal
  // file:line into logs/reporters).
  const source = includeSource ? headers.get('X-Schemind-Source') : null
  if (hash === null && versionRaw === null && source === null) return undefined

  const meta: AdapterMeta = {}
  // Only accept a well-formed 8-hex hash — a malformed value never enters meta.
  if (isValidSchemaHash(hash)) meta.schemaHash = hash
  if (source !== null) meta.source = source
  if (versionRaw !== null) {
    const version = Number(versionRaw)
    if (Number.isFinite(version)) meta.schemaVersion = version
  }
  // If the only header present was a malformed hash, there's nothing to report.
  return Object.keys(meta).length > 0 ? meta : undefined
}

/** Normalize the observe-rate option into `[0, 1]`, defaulting to `1`. */
function clampRate(rate: number | undefined): number {
  if (rate === undefined || Number.isNaN(rate)) return 1
  return Math.min(1, Math.max(0, rate))
}

/** Decide whether this response falls within the sampling rate. */
function sampled(rate: number, random: () => number): boolean {
  if (rate >= 1) return true
  if (rate <= 0) return false
  return random() < rate
}

/** True when the body is within the cap (or unsized and allowed). */
function withinSizeLimit(
  contentLength: string | null,
  maxBytes: number,
  skipUnsized: boolean,
): boolean {
  if (maxBytes <= 0 || !Number.isFinite(maxBytes)) return true
  if (contentLength === null) return !skipUnsized // chunked / unknown
  const size = Number(contentLength)
  if (!Number.isFinite(size)) return true
  return size <= maxBytes
}

function isProduction(): boolean {
  return typeof process !== 'undefined' && process.env?.NODE_ENV === 'production'
}

/**
 * True for `application/json` and structured-syntax JSON suffixes
 * (`application/ld+json`, `application/problem+json`, `text/json`), ignoring
 * any `; charset=…` parameters. Avoids the over-broad `includes('json')`.
 */
function isJsonContentType(contentType: string | null): boolean {
  if (!contentType) return false
  return /^[^;]*\/(?:[^;]+\+)?json\s*(?:;|$)/i.test(contentType.trim())
}

function defaultEnabled(): boolean {
  if (typeof process !== 'undefined' && process.env?.SCHEMIND_ENABLED === 'false') {
    return false
  }
  return true
}
