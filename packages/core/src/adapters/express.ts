import { type Schemind, type SchemindOptions, createSchemind } from '../engine.js'
import { type AdapterHooks, observeBody } from './shared.js'

/** Minimal structural types so we don't depend on `express`. */
interface ExpressReq {
  method: string
  originalUrl?: string
  url: string
  /** Parsed by an upstream body parser (e.g. `express.json()`), when present. */
  body?: unknown
}
interface ExpressRes {
  statusCode: number
  json(body: unknown): unknown
}
type ExpressNext = () => void
type ExpressMiddleware = (req: ExpressReq, res: ExpressRes, next: ExpressNext) => void

/** Options for {@link schemindExpress}. */
export interface ExpressAdapterOptions extends SchemindOptions, AdapterHooks {
  /** A pre-built engine; otherwise one is created from the options. */
  engine?: Schemind
}

/**
 * Express middleware that observes every JSON response shape.
 *
 * ```ts
 * import { schemindExpress } from 'schemind/express'
 * app.use(schemindExpress({ onObserve: (r) => r.report && console.log(r.report) }))
 * ```
 *
 * It wraps `res.json(...)`, observes the body asynchronously, then forwards to
 * the original — never delaying the response.
 */
export function schemindExpress(options: ExpressAdapterOptions = {}): ExpressMiddleware {
  const engine = options.engine ?? createSchemind(options)
  return (req, res, next) => {
    const originalJson = res.json.bind(res)
    res.json = (body: unknown): unknown => {
      observeBody(
        engine,
        {
          method: req.method,
          url: req.originalUrl ?? req.url,
          statusCode: res.statusCode,
          body,
          // Track the request-body shape too, when a body parser populated it.
          ...(req.body !== undefined ? { requestBody: req.body } : {}),
        },
        options,
      )
      return originalJson(body)
    }
    next()
  }
}
