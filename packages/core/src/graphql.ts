import type { ObserveResult, Schemind } from './engine.js'

/** A single GraphQL operation result handed to {@link observeGraphql}. */
export interface GraphqlObserveInput {
  /** Operation name. Derived from {@link query} when omitted. */
  operationName?: string
  /** The raw GraphQL document (used to derive the operation name if needed). */
  query?: string
  /** The full GraphQL JSON response (`{ data, errors }`). */
  body: unknown
  /** HTTP status. Default `200`. */
  statusCode?: number
}

/**
 * Observe a GraphQL operation's response shape. GraphQL responses are JSON with
 * a `{ data, errors }` envelope; this keys the snapshot on the **operation name**
 * (`POST /graphql/<op>`) and strips the envelope so the `data` shape is what's
 * tracked.
 */
export function observeGraphql(
  engine: Schemind,
  input: GraphqlObserveInput,
): Promise<ObserveResult> {
  const op = input.operationName ?? operationNameFrom(input.query) ?? 'anonymous'
  const data = isRecord(input.body) && 'data' in input.body ? input.body.data : input.body
  return engine.observe({
    method: 'POST',
    url: `/graphql/${encodeURIComponent(op)}`,
    statusCode: input.statusCode ?? 200,
    body: data,
  })
}

function operationNameFrom(query: string | undefined): string | undefined {
  if (!query) return undefined
  const match = query.match(/\b(?:query|mutation|subscription)\s+([A-Za-z_][A-Za-z0-9_]*)/)
  return match?.[1]
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
