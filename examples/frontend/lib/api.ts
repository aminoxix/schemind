import { Data, Effect } from 'effect'
import type { z } from 'zod'
import { schemindFetch } from './schemind'
import {
  type BackendTarget,
  type BookInput,
  type DriftMode,
  bookResponseSchema,
  booksResponseSchema,
  deleteResponseSchema,
  driftResponseSchema,
} from './types'

const BASE_URL: Record<BackendTarget, string> = {
  go: process.env.NEXT_PUBLIC_GO_URL ?? 'http://localhost:8080',
  java: process.env.NEXT_PUBLIC_JAVA_URL ?? 'http://localhost:8081',
}

/* ------------------------------- typed errors ----------------------------- */

export class NetworkError extends Data.TaggedError('NetworkError')<{ cause: unknown }> {}
export class ApiError extends Data.TaggedError('ApiError')<{ status: number; url: string }> {}
export class DecodeError extends Data.TaggedError('DecodeError')<{ issues: z.ZodIssue[] }> {}

export type ApiFailure = NetworkError | ApiError | DecodeError

/* ----------------------------- request pipeline --------------------------- */

interface RequestSpec<S extends z.ZodTypeAny> {
  backend: BackendTarget
  method: string
  path: string
  schema: S
  body?: unknown
}

/**
 * A single API call modeled as an `Effect` — failures are typed (network vs HTTP
 * vs decode) rather than untyped `throw`s. The request flows through
 * `schemindFetch`, so every response is observed for shape drift along the way.
 * The success type is the schema's *output* (`z.output`), so decoded defaults
 * (e.g. `tags`) stay non-optional downstream.
 */
function request<S extends z.ZodTypeAny>(
  spec: RequestSpec<S>,
): Effect.Effect<z.output<S>, ApiFailure> {
  const url = `${BASE_URL[spec.backend]}${spec.path}`
  return Effect.gen(function* () {
    const res = yield* Effect.tryPromise({
      try: (): Promise<Response> =>
        schemindFetch(url, {
          method: spec.method,
          ...(spec.body !== undefined
            ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(spec.body) }
            : {}),
        }),
      catch: (cause) => new NetworkError({ cause }),
    })

    if (!res.ok) return yield* Effect.fail(new ApiError({ status: res.status, url }))

    const json = yield* Effect.tryPromise({
      try: (): Promise<unknown> => res.json(),
      catch: (cause) => new NetworkError({ cause }),
    })

    const parsed = spec.schema.safeParse(json)
    return parsed.success
      ? parsed.data
      : yield* Effect.fail(new DecodeError({ issues: parsed.error.issues }))
  })
}

export const booksApi = {
  list: (backend: BackendTarget) =>
    request({ backend, method: 'GET', path: '/api/books', schema: booksResponseSchema }),

  create: (backend: BackendTarget, body: BookInput) =>
    request({ backend, method: 'POST', path: '/api/books', body, schema: bookResponseSchema }),

  update: (backend: BackendTarget, id: string, body: BookInput) =>
    request({ backend, method: 'PUT', path: `/api/books/${id}`, body, schema: bookResponseSchema }),

  remove: (backend: BackendTarget, id: string) =>
    request({ backend, method: 'DELETE', path: `/api/books/${id}`, schema: deleteResponseSchema }),

  /** Demo control: flip the backend's response shape to simulate drift. */
  setDrift: (backend: BackendTarget, mode: DriftMode) =>
    request({
      backend,
      method: 'POST',
      path: `/api/_drift?mode=${mode}`,
      schema: driftResponseSchema,
    }),
}

/* ------------------------- run into TanStack Query ------------------------ */

function toError(failure: ApiFailure): Error {
  switch (failure._tag) {
    case 'ApiError':
      return new Error(`${failure.url} → ${failure.status}`)
    case 'NetworkError':
      return new Error('network error — is the backend running?')
    case 'DecodeError':
      return new Error(`unexpected response shape (${failure.issues.length} issue(s))`)
  }
}

/** Run an API `Effect` to a Promise, mapping typed failures to a readable `Error`. */
export function runApi<A>(effect: Effect.Effect<A, ApiFailure>): Promise<A> {
  return Effect.runPromise(Effect.mapError(effect, toError))
}
