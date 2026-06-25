import { type Schemind, type SchemindOptions, createSchemind } from '../engine.js'
import { type AdapterHooks, observeResponse } from './shared.js'

/** Minimal structural type for a Hono context. */
interface HonoContext {
  /** Hono caches `json()`, so it's safe to call after the handler ran. */
  req: { method: string; url: string; json(): Promise<unknown> }
  res: Response
}
type HonoMiddleware = (c: HonoContext, next: () => Promise<void>) => Promise<void>

/** Options for {@link schemindHono}. */
export interface HonoAdapterOptions extends SchemindOptions, AdapterHooks {
  engine?: Schemind
}

/**
 * Hono middleware that observes every JSON response shape.
 *
 * ```ts
 * import { schemindHono } from 'schemind/hono'
 * app.use('*', schemindHono())
 * ```
 *
 * Runs `next()` first, then observes `c.res` from a clone — never altering it.
 */
export function schemindHono(options: HonoAdapterOptions = {}): HonoMiddleware {
  const engine = options.engine ?? createSchemind(options)
  return async (c, next) => {
    await next()
    const method = c.req.method.toUpperCase()
    const getRequestBody = method === 'GET' || method === 'HEAD' ? undefined : () => c.req.json()
    observeResponse(
      engine,
      { method: c.req.method, url: c.req.url },
      c.res,
      options,
      getRequestBody,
    )
  }
}
