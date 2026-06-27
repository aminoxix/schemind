/**
 * TanStack Query (React Query) integration for schemind.
 *
 * Three integration levels — pick what fits:
 *
 * 1. `createSchemindQueryClient` — zero per-query changes, wraps the whole
 *    QueryClient so every query/mutation is auto-observed.
 * 2. `useSchemindQuery` / `useSchemindMutation` — drop-in hooks for granular
 *    per-query control.
 * 3. `wrapQueryFn` — low-level utility for custom hooks or non-React contexts.
 *
 * All observation calls are fire-and-forget and never delay query results.
 *
 * @example
 * ```ts
 * // Wrap the whole client (recommended)
 * const queryClient = createSchemindQueryClient({ onObserve: console.log })
 *
 * // Or opt in per query
 * const engine = createSchemind()
 * const { data } = useSchemindQuery({ queryKey: ['users'], queryFn: fetchUsers, endpoint: 'GET /api/users', engine })
 * ```
 */

import {
  MutationCache,
  QueryCache,
  QueryClient,
  useMutation,
  useQuery,
} from '@tanstack/react-query'
import type {
  DefaultError,
  MutationKey,
  QueryKey,
  UseMutationOptions,
  UseMutationResult,
  UseQueryOptions,
  UseQueryResult,
} from '@tanstack/react-query'
import { type AdapterHooks, observeBody } from './adapters/shared.js'
import {
  type ObserveResult,
  type Schemind,
  type SchemindOptions,
  createSchemind,
} from './engine.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])

/** Dev-only one-time warning when a hook is used without an `engine` (no-op observe). */
const missingEngineWarned = new Set<string>()
function warnMissingEngine(where: string): void {
  if (missingEngineWarned.has(where)) return
  missingEngineWarned.add(where)
  const isProd = typeof process !== 'undefined' && process.env?.NODE_ENV === 'production'
  if (isProd) return
  console.warn(
    `[schemind] ${where}: no \`engine\` provided — drift observation is disabled and the hook behaves like a plain TanStack hook. Pass \`engine\` to enable it.`,
  )
}

/**
 * Best-effort conversion of a TanStack Query/Mutation key into a schemind
 * endpoint label. Only used when you DON'T pass an explicit `endpoint`. Cache
 * keys are arbitrary client identifiers, not routes, so prefer passing
 * `endpoint` for anything you care about. Conventions:
 * - `['GET', '/api/users']` → `GET /api/users`   (explicit `[VERB, /path]` form)
 * - `['users', '42']`       → `<default> /users/42`
 * - `'users'`               → `<default> /users`
 *
 * Note: object segments (e.g. a `{ filters }` object) are dropped, so keys that
 * differ only by an object segment collapse to the same endpoint — pass an
 * explicit `endpoint` when those must be tracked separately.
 */
function keyToEndpoint(key: QueryKey, defaultMethod: 'GET' | 'POST'): string {
  const parts = (Array.isArray(key) ? key : [key])
    .filter((k) => k !== null && k !== undefined && typeof k !== 'object')
    .map(String)

  if (parts.length === 0) return `${defaultMethod} /unknown`

  const [first, ...rest] = parts
  // Treat the first segment as a method only when it's an ALL-UPPERCASE HTTP
  // verb (the conventional `['GET', '/api/users']` / `['GET', 'users']` form).
  // A lowercase `get` is a resource name, not a method, so it stays in the path.
  if (first && first === first.toUpperCase() && HTTP_METHODS.has(first)) {
    const path = rest.join('/')
    return `${first} ${path ? (path.startsWith('/') ? path : `/${path}`) : '/'}`
  }
  return `${defaultMethod} /${parts.join('/')}`
}

const queryKeyToEndpoint = (key: QueryKey): string => keyToEndpoint(key, 'GET')

const mutationKeyToEndpoint = (key: MutationKey | undefined): string =>
  key ? keyToEndpoint(key as QueryKey, 'POST') : 'POST /unknown'

/**
 * Split an endpoint label (`"GET /api/books"`) into the `{ method, url }` that
 * `engine.observe` expects. The engine re-prepends the method via
 * `normalizeEndpoint`, so the label's verb must NOT be left inside `url` (doing
 * so produces a mangled key like `GET /GET%20/api/books`). When the label has
 * no recognizable `VERB /path` prefix, fall back to `fallbackMethod`.
 */
function splitEndpoint(endpoint: string, fallbackMethod: string): { method: string; url: string } {
  const match = /^([A-Za-z]+)\s+(.+)$/.exec(endpoint)
  const verb = match?.[1]?.toUpperCase()
  const rest = match?.[2]
  // Only treat the prefix as a method when it's a real HTTP verb, so a path-only
  // label (or a verb-less one) is never mistaken for "method path".
  if (verb && rest && HTTP_METHODS.has(verb)) {
    return { method: verb, url: rest.startsWith('/') ? rest : `/${rest}` }
  }
  return {
    method: fallbackMethod.toUpperCase(),
    url: endpoint.startsWith('/') ? endpoint : `/${endpoint}`,
  }
}

interface ObserveCallbacks {
  onObserve?: ((result: ObserveResult) => void) | undefined
  onError?: ((error: unknown) => void) | undefined
}

function fireObserve(
  engine: Schemind,
  endpoint: string,
  fallbackMethod: string,
  payload: { body: unknown; requestBody?: unknown; statusCode?: number | undefined },
  callbacks: ObserveCallbacks,
): void {
  const { method, url } = splitEndpoint(endpoint, fallbackMethod)
  // Reuse the shared adapter helper so the fire-and-forget + onObserve/onError
  // contract stays identical to every other schemind adapter.
  const hooks: AdapterHooks = {}
  if (callbacks.onObserve) hooks.onObserve = callbacks.onObserve
  if (callbacks.onError) hooks.onError = callbacks.onError
  observeBody(
    engine,
    {
      method,
      url,
      statusCode: payload.statusCode ?? 200,
      body: payload.body,
      ...(payload.requestBody !== undefined ? { requestBody: payload.requestBody } : {}),
    },
    hooks,
  )
}

// ─── createSchemindQueryClient ─────────────────────────────────────────────────

export interface SchemindQueryClientOptions {
  /**
   * Bring your own engine. When omitted a fresh in-memory engine is created
   * using `schemindOptions`.
   */
  engine?: Schemind
  /** Passed to `createSchemind()` when `engine` is not provided. */
  schemindOptions?: SchemindOptions
  /** Called after every observation (success or first-seen). */
  onObserve?: (result: ObserveResult) => void
  /** Called if an observation fails. Never surfaces to the query/mutation. */
  onError?: (error: unknown) => void
  /**
   * Status code recorded for observations. Defaults to `200`. The cache
   * callbacks only fire on success, so override only if your queryFns resolve
   * (rather than throw) on non-2xx responses and you want that reflected.
   */
  statusCode?: number
  /**
   * Standard `QueryClient` constructor config. `queryCache` and
   * `mutationCache` are merged — schemind callbacks are appended, not
   * replaced.
   */
  queryClientConfig?: ConstructorParameters<typeof QueryClient>[0]
}

/**
 * Creates a `QueryClient` that automatically observes every successful
 * query and mutation — no per-query changes required.
 *
 * @example
 * ```ts
 * const queryClient = createSchemindQueryClient({
 *   onObserve: ({ endpoint, report }) => {
 *     if (report?.severity === 'breaking') alert(`Drift on ${endpoint}!`)
 *   },
 * })
 *
 * // In your app root:
 * <QueryClientProvider client={queryClient}>...</QueryClientProvider>
 * ```
 */
export function createSchemindQueryClient(options: SchemindQueryClientOptions = {}): QueryClient {
  const engine = options.engine ?? createSchemind(options.schemindOptions)
  const { onObserve, onError, statusCode, queryClientConfig = {} } = options
  const callbacks: ObserveCallbacks = { onObserve, onError }

  const userQueryCache = queryClientConfig.queryCache
  const userMutationCache = queryClientConfig.mutationCache

  const queryCache = new QueryCache({
    ...userQueryCache?.config,
    onSuccess(data, query) {
      userQueryCache?.config?.onSuccess?.(data, query)
      const endpoint = queryKeyToEndpoint(query.queryKey)
      fireObserve(engine, endpoint, 'GET', { body: data, statusCode }, callbacks)
    },
  })

  const mutationCache = new MutationCache({
    ...userMutationCache?.config,
    onSuccess(data, variables, onMutateResult, mutation, context) {
      userMutationCache?.config?.onSuccess?.(data, variables, onMutateResult, mutation, context)
      const endpoint = mutationKeyToEndpoint(mutation.options.mutationKey)
      fireObserve(
        engine,
        endpoint,
        'POST',
        { body: data, requestBody: variables, statusCode },
        callbacks,
      )
    },
  })

  return new QueryClient({
    ...queryClientConfig,
    queryCache,
    mutationCache,
  })
}

// ─── wrapQueryFn ──────────────────────────────────────────────────────────────

export interface WrapQueryFnOptions {
  engine: Schemind
  method?: string
  onObserve?: ((result: ObserveResult) => void) | undefined
  /** Called if an observation fails. Never surfaces to the caller. */
  onError?: ((error: unknown) => void) | undefined
  /** Status code recorded for the observation. Defaults to `200`. */
  statusCode?: number | undefined
}

/**
 * Wraps a `queryFn` so its result is observed by schemind.
 * The observation is fire-and-forget — the original data is returned
 * immediately without any added latency.
 *
 * @example
 * ```ts
 * const { data } = useQuery({
 *   queryKey: ['books'],
 *   queryFn: wrapQueryFn('GET /api/books', fetchBooks, { engine }),
 * })
 * ```
 */
export function wrapQueryFn<T>(
  endpoint: string,
  fn: () => Promise<T>,
  options: WrapQueryFnOptions,
): () => Promise<T> {
  const { engine, method = 'GET', onObserve, onError, statusCode } = options
  return async () => {
    const data = await fn()
    fireObserve(engine, endpoint, method, { body: data, statusCode }, { onObserve, onError })
    return data
  }
}

// ─── useSchemindQuery ──────────────────────────────────────────────────────────

export interface SchemindQueryOptions<
  TQueryFnData,
  TError = DefaultError,
  TData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
> extends Omit<UseQueryOptions<TQueryFnData, TError, TData, TQueryKey>, 'queryFn'> {
  /** Required: the async function that fetches data. */
  queryFn: () => Promise<TQueryFnData>
  /**
   * Endpoint label for schemind, e.g. `"GET /api/books"`.
   * When omitted the query key is converted automatically.
   */
  endpoint?: string
  /** Schemind engine instance. Required for per-query observation. */
  engine?: Schemind
  /** Called after each observation. */
  onObserve?: (result: ObserveResult) => void
  /** Called if an observation fails. Never surfaces to the query. */
  onError?: (error: unknown) => void
  /** Status code recorded for the observation. Defaults to `200`. */
  statusCode?: number
}

/**
 * Drop-in replacement for `useQuery` that observes the response shape.
 * Fully supports `select` — `TQueryFnData` is what `queryFn` returns,
 * `TData` is what `select` transforms it into.
 *
 * @example
 * ```ts
 * const engine = createSchemind()
 *
 * const { data } = useSchemindQuery({
 *   queryKey: ['books'],
 *   queryFn: () => fetch('/api/books').then(r => r.json()),
 *   endpoint: 'GET /api/books',
 *   engine,
 *   select: (res) => res.data,
 *   onObserve: ({ report }) => report?.severity === 'breaking' && alert('Drift!'),
 * })
 * ```
 */
export function useSchemindQuery<
  TQueryFnData,
  TError = DefaultError,
  TData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
>(
  options: SchemindQueryOptions<TQueryFnData, TError, TData, TQueryKey>,
): UseQueryResult<TData, TError> {
  const { endpoint, engine, onObserve, onError, statusCode, queryFn, queryKey, ...rest } = options

  const resolvedEndpoint = endpoint ?? queryKeyToEndpoint(queryKey as QueryKey)

  let wrappedFn = queryFn
  if (engine != null) {
    wrappedFn = wrapQueryFn(resolvedEndpoint, queryFn, { engine, onObserve, onError, statusCode })
  } else {
    warnMissingEngine('useSchemindQuery')
  }

  return useQuery({
    ...(rest as UseQueryOptions<TQueryFnData, TError, TData, TQueryKey>),
    queryKey,
    queryFn: wrappedFn,
  })
}

// ─── useSchemindMutation ───────────────────────────────────────────────────────

export interface SchemindMutationOptions<
  TData,
  TError = DefaultError,
  TVariables = void,
  TContext = unknown,
> extends Omit<UseMutationOptions<TData, TError, TVariables, TContext>, 'mutationFn'> {
  /** Required: the async function that performs the mutation. */
  mutationFn: (variables: TVariables) => Promise<TData>
  /**
   * Endpoint label, e.g. `"POST /api/books"`.
   * When omitted the mutation key is used (if present) or `POST /unknown`.
   */
  endpoint?: string
  /** Schemind engine instance. Required for per-mutation observation. */
  engine?: Schemind
  /**
   * HTTP method for the observation record. Defaults to `"POST"`.
   * Override to `"PUT"` / `"PATCH"` / `"DELETE"` when appropriate.
   */
  method?: string
  /** Called after each observation. */
  onObserve?: (result: ObserveResult) => void
  /** Called if an observation fails. Never surfaces to the mutation. */
  onError?: (error: unknown) => void
  /** Status code recorded for the observation. Defaults to `200`. */
  statusCode?: number
}

/**
 * Drop-in replacement for `useMutation` that observes both the request
 * variables and the response shape.
 *
 * @example
 * ```ts
 * const createBook = useSchemindMutation({
 *   endpoint: 'POST /api/books',
 *   engine,
 *   mutationFn: (book: BookInput) =>
 *     fetch('/api/books', { method: 'POST', body: JSON.stringify(book) }).then(r => r.json()),
 *   onObserve: ({ report }) => console.log('mutation drift', report),
 * })
 *
 * createBook.mutate({ title: 'Dune', author: 'Herbert' })
 * ```
 */
export function useSchemindMutation<
  TData,
  TError = DefaultError,
  TVariables = void,
  TContext = unknown,
>(
  options: SchemindMutationOptions<TData, TError, TVariables, TContext>,
): UseMutationResult<TData, TError, TVariables, TContext> {
  const {
    endpoint,
    engine,
    method = 'POST',
    onObserve,
    onError,
    statusCode,
    mutationFn,
    mutationKey,
    ...rest
  } = options

  const resolvedEndpoint = endpoint ?? mutationKeyToEndpoint(mutationKey)

  let wrappedFn = mutationFn
  if (engine != null) {
    wrappedFn = async (variables: TVariables): Promise<TData> => {
      const data = await mutationFn(variables)
      fireObserve(
        engine,
        resolvedEndpoint,
        method,
        { body: data, requestBody: variables, statusCode },
        { onObserve, onError },
      )
      return data
    }
  } else {
    warnMissingEngine('useSchemindMutation')
  }

  return useMutation({
    ...(rest as UseMutationOptions<TData, TError, TVariables, TContext>),
    ...(mutationKey ? { mutationKey } : {}),
    mutationFn: wrappedFn,
  })
}
