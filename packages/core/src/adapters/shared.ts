import type { ObserveInput, ObserveResult, Schemind } from '../engine.js'

/** Common hooks shared by every middleware adapter. */
export interface AdapterHooks {
  /** Called (after the framework's response is sent) with each observation. */
  onObserve?: (result: ObserveResult) => void
  /** Called if observation fails. Never surfaces to the request. */
  onError?: (error: unknown) => void
}

const JSON_RE = /^[^;]*\/(?:[^;]+\+)?json\s*(?:;|$)/i

export function isJsonContentType(contentType: string | null | undefined): boolean {
  return contentType ? JSON_RE.test(contentType.trim()) : false
}

/**
 * Observe an already-parsed JSON body without blocking the caller. Fire-and-forget:
 * the returned promise can be ignored.
 */
export function observeBody(engine: Schemind, input: ObserveInput, hooks: AdapterHooks): void {
  void engine
    .observe(input)
    .then((result) => hooks.onObserve?.(result))
    .catch((error) => hooks.onError?.(error))
}

/**
 * Observe a `Response`-like object (Fetch API `Response`) by cloning + parsing
 * its JSON body asynchronously. No-op for non-JSON responses.
 *
 * `getRequestBody` (optional) lets an adapter feed the parsed request body so
 * request-shape drift is tracked too; it must read an already-cloned/buffered
 * body so the handler isn't disturbed.
 */
export function observeResponse(
  engine: Schemind,
  meta: { method: string; url: string },
  response: Response,
  hooks: AdapterHooks,
  getRequestBody?: () => Promise<unknown>,
): void {
  try {
    if (!response.body || !isJsonContentType(response.headers.get('content-type'))) return
    const clone = response.clone()
    void Promise.all([
      clone.json(),
      getRequestBody ? getRequestBody().catch(() => undefined) : Promise.resolve(undefined),
    ])
      .then(([body, requestBody]) =>
        engine.observe({
          method: meta.method,
          url: meta.url,
          statusCode: response.status,
          body,
          ...(requestBody !== undefined ? { requestBody } : {}),
        }),
      )
      .then((result) => hooks.onObserve?.(result))
      .catch((error) => hooks.onError?.(error))
  } catch (error) {
    hooks.onError?.(error)
  }
}

/** Best-effort parse of a JSON request body (clone first so the handler isn't disturbed). */
export async function readRequestJson(req: {
  method?: string
  headers?: { get(name: string): string | null }
  clone?: () => { json(): Promise<unknown> }
  json?: () => Promise<unknown>
}): Promise<unknown> {
  const method = (req.method ?? 'GET').toUpperCase()
  if (method === 'GET' || method === 'HEAD') return undefined
  const ct = req.headers?.get('content-type')
  if (ct !== undefined && ct !== null && !isJsonContentType(ct)) return undefined
  try {
    const source = req.clone ? req.clone() : req
    return source.json ? await source.json() : undefined
  } catch {
    return undefined
  }
}
