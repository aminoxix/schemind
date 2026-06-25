import { type Schemind, type SchemindOptions, createSchemind } from '../engine.js'
import { type AdapterHooks, observeResponse, readRequestJson } from './shared.js'

/** Options for {@link withSchemind}. */
export interface NextAdapterOptions extends SchemindOptions, AdapterHooks {
  engine?: Schemind
}

/** A Next.js App-Router route handler: `(req: Request, ctx?) => Response`. */
type RouteHandler = (request: Request, ...rest: unknown[]) => Response | Promise<Response>

/**
 * Wrap a Next.js App-Router route handler so its JSON response shape is observed.
 *
 * ```ts
 * import { withSchemind } from 'schemind/next'
 * export const GET = withSchemind(async (req) => Response.json(await getUsers()))
 * ```
 *
 * The original response is returned unchanged; the shape is read from a clone.
 */
export function withSchemind(
  handler: RouteHandler,
  options: NextAdapterOptions = {},
): RouteHandler {
  const engine = options.engine ?? createSchemind(options)
  return async (request, ...rest) => {
    // Clone before the handler consumes the body, so we can read the request shape.
    const reqClone = request.clone()
    const response = await handler(request, ...rest)
    observeResponse(engine, { method: request.method, url: request.url }, response, options, () =>
      readRequestJson(reqClone),
    )
    return response
  }
}
