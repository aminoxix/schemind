import { diffReport } from './diff.js'
import { type ExtractOptions, extractShape } from './extractor.js'
import { DEFAULT_PARAM_PATTERNS, type ParamPattern, normalizeEndpoint } from './normalize.js'
import { runReporters } from './pipeline.js'
import { SnapshotStore } from './snapshot.js'
import type { AdapterMeta, DriftReport, ObservedResponse, Reporter } from './types.js'
import { isValidSchemaHash } from './validate.js'

/** Construction options for {@link createSchemind}. */
export interface SchemindOptions {
  /** Snapshot store. Defaults to an in-memory store. */
  store?: SnapshotStore
  /** Reporters notified whenever drift is detected. Default: none. */
  reporters?: Reporter[]
  /** Shape-extraction tuning. */
  extract?: ExtractOptions
  /** Endpoint param-normalization rules. */
  paramPatterns?: readonly ParamPattern[]
  /**
   * Include the request origin in the endpoint key for absolute URLs (so two
   * hosts don't share a baseline). Default `true`. See {@link NormalizeOptions}.
   */
  includeOrigin?: boolean
  /**
   * Predicate deciding whether a response should be learned/diffed at all.
   * Default: **2xx only**. Error envelopes (4xx/5xx) have a different shape than
   * success bodies, so learning them against the same endpoint would produce
   * false drift — they are skipped unless you opt in.
   */
  shouldObserve?: (input: ObserveInput) => boolean
  /**
   * Trust the backend adapter's `X-Schemind-Schema-Hash` to skip extraction when
   * it matches the baseline. **Default `false`** — the header is attacker-
   * controllable, and a compromised API could send a matching hash to hide real
   * drift. Enable only when the target is trusted and runs a schemind adapter.
   */
  trustAdapterHash?: boolean
  /**
   * When true, the stored baseline is advanced to the newly-observed shape after
   * drift is detected (so the same drift isn't re-reported). Default `false`,
   * which keeps drift visible until explicitly accepted — the right behaviour for
   * CI gates and watch dashboards.
   */
  updateOnDrift?: boolean
  /** ISO-timestamp clock for `observedAt`. Overridable in tests. */
  now?: () => string
}

/** Default observability gate: only successful (2xx) responses are learned. */
const isSuccess = (input: ObserveInput): boolean =>
  input.statusCode >= 200 && input.statusCode < 300

/** A single response handed to {@link Schemind.observe}. */
export interface ObserveInput {
  method: string
  /** Absolute or relative request URL. */
  url: string
  statusCode: number
  /** Parsed JSON response body (already `JSON.parse`d). */
  body: unknown
  /**
   * Parsed request body, when available. Tracked under a separate `… [request]`
   * baseline so client-side contract drift (a removed required POST field) is
   * caught too. Omit to skip request-shape tracking.
   */
  requestBody?: unknown
  /** Backend adapter metadata, when available. */
  meta?: AdapterMeta
}

/** Result of observing one response. */
export interface ObserveResult {
  /** Normalized endpoint key, e.g. `GET /api/books/:id`. */
  endpoint: string
  /** The structural observation. */
  observed: ObservedResponse
  /**
   * The drift report. `null` when the endpoint was first seen (baseline created)
   * or when the adapter hash fast-path skipped extraction.
   */
  report: DriftReport | null
  /** True when no prior baseline existed and one was created. */
  created: boolean
  /** True when an adapter hash matched the baseline and extraction was skipped. */
  skipped: boolean
  /** Drift report for the request body, when `requestBody` was provided. */
  requestReport?: DriftReport | null
}

/**
 * The schemind engine: the full observe pipeline from {@link ARCHITECTURE.md}'s
 * "Data Flow Summary" — hash fast-path → extract → snapshot create-or-diff →
 * reporters.
 */
export class Schemind {
  private readonly store: SnapshotStore
  private readonly reporters: Reporter[]
  private readonly extract: ExtractOptions
  private readonly paramPatterns: readonly ParamPattern[]
  private readonly includeOrigin: boolean
  private readonly shouldObserve: (input: ObserveInput) => boolean
  private readonly trustAdapterHash: boolean
  private readonly updateOnDrift: boolean
  private readonly now: () => string

  /** Per-endpoint tail promises — serialize load→commit so concurrent observes can't race. */
  private readonly locks = new Map<string, Promise<unknown>>()

  constructor(options: SchemindOptions = {}) {
    this.store = options.store ?? new SnapshotStore()
    this.reporters = options.reporters ?? []
    this.extract = options.extract ?? {}
    this.paramPatterns = options.paramPatterns ?? DEFAULT_PARAM_PATTERNS
    this.includeOrigin = options.includeOrigin ?? true
    this.shouldObserve = options.shouldObserve ?? isSuccess
    this.trustAdapterHash = options.trustAdapterHash ?? false
    this.updateOnDrift = options.updateOnDrift ?? false
    this.now = options.now ?? (() => new Date().toISOString())
  }

  /** The underlying snapshot store (for inspection, listing, rollback). */
  getStore(): SnapshotStore {
    return this.store
  }

  /**
   * Observe one response and return what changed (if anything). Reporters fire
   * only when drift with at least one change is detected.
   */
  async observe(input: ObserveInput): Promise<ObserveResult> {
    const endpoint = normalizeEndpoint(input.method, input.url, {
      patterns: this.paramPatterns,
      includeOrigin: this.includeOrigin,
    })
    const observedAt = this.now()
    const hasRequest = input.requestBody !== undefined

    // Observability gate: don't learn error envelopes against a success baseline.
    if (!this.shouldObserve(input)) {
      const shape = extractShape(input.body, this.extract)
      const skipped: ObserveResult = {
        endpoint,
        observed: this.toObserved(endpoint, input, shape, observedAt),
        report: null,
        created: false,
        skipped: true,
      }
      return hasRequest ? { ...skipped, requestReport: null } : skipped
    }

    // Serialize per endpoint so the load→diff→commit sequence is atomic and
    // concurrent observations can't read a stale baseline or clobber history.
    const hash = sanitizeHash(input.meta?.schemaHash)
    const result = await this.withLock(endpoint, () =>
      this.observeResponse(endpoint, input, observedAt, hash),
    )

    if (!hasRequest) return result

    // Track the request body under its own `… [request]` baseline (F6).
    const reqKey = `${endpoint} [request]`
    const reqShape = extractShape(input.requestBody, this.extract)
    const req = await this.withLock(reqKey, () => this.reconcile(reqKey, reqShape, undefined))
    return { ...result, requestReport: req.report }
  }

  private async observeResponse(
    endpoint: string,
    input: ObserveInput,
    observedAt: string,
    hash: string | undefined,
  ): Promise<ObserveResult> {
    const prev = await this.store.load(endpoint)

    // Fast-path: adapter hash matches the baseline → nothing changed, skip work.
    // Gated behind trustAdapterHash since the header is attacker-controllable.
    if (this.trustAdapterHash && hash !== undefined && prev?.hash === hash) {
      return {
        endpoint,
        observed: this.toObserved(endpoint, input, prev.shape, observedAt),
        report: null,
        created: false,
        skipped: true,
      }
    }

    const shape = extractShape(input.body, this.extract)
    const observed = this.toObserved(endpoint, input, shape, observedAt)
    const { report, created } = await this.reconcileWith(endpoint, prev, shape, hash)
    return { endpoint, observed, report, created, skipped: false }
  }

  /** Load the baseline at `key`, then diff/commit `shape` against it. */
  private async reconcile(
    key: string,
    shape: ObservedResponse['shape'],
    hash: string | undefined,
  ): Promise<{ report: DriftReport | null; created: boolean }> {
    return this.reconcileWith(key, await this.store.load(key), shape, hash)
  }

  /** Diff/commit `shape` against an already-loaded baseline. */
  private async reconcileWith(
    key: string,
    prev: Awaited<ReturnType<SnapshotStore['load']>>,
    shape: ObservedResponse['shape'],
    hash: string | undefined,
  ): Promise<{ report: DriftReport | null; created: boolean }> {
    if (!prev) {
      await this.store.commit(key, shape, hash !== undefined ? { hash } : {})
      return { report: null, created: true }
    }

    const report = diffReport(key, prev.shape, shape)
    if (report.changes.length > 0) {
      await runReporters(this.reporters, report)
      if (this.updateOnDrift) {
        await this.store.commit(key, shape, hash !== undefined ? { hash } : {})
      }
    } else if (hash !== undefined && prev.hash !== hash) {
      // Shape identical but the adapter hash appeared/changed — record it (in
      // place, no version bump) for future fast-path hits.
      await this.store.commit(key, shape, { hash })
    }
    return { report, created: false }
  }

  /**
   * Run `fn` mutually-exclusively per `key`: each call chains onto the previous
   * one for the same key, so there's no interleaving between a `load` and its
   * follow-up `commit`. Failures don't break the chain; the map entry is freed
   * once the tail settles.
   */
  private withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) ?? Promise.resolve()
    const result = prev.then(fn, fn)
    const tail = result.then(noop, noop)
    this.locks.set(key, tail)
    void tail.then(() => {
      if (this.locks.get(key) === tail) this.locks.delete(key)
    })
    return result
  }

  private toObserved(
    endpoint: string,
    input: ObserveInput,
    shape: ObservedResponse['shape'],
    observedAt: string,
  ): ObservedResponse {
    return {
      endpoint,
      statusCode: input.statusCode,
      shape,
      observedAt,
      ...(input.meta !== undefined ? { meta: input.meta } : {}),
    }
  }
}

function noop(): void {
  /* swallow — used to keep the per-endpoint lock chain alive past failures */
}

/** Accept an adapter hash only if it's a well-formed 8-char hex string. */
function sanitizeHash(hash: string | undefined): string | undefined {
  return isValidSchemaHash(hash) ? hash : undefined
}

/** Convenience factory mirroring {@link Schemind}'s constructor. */
export function createSchemind(options?: SchemindOptions): Schemind {
  return new Schemind(options)
}
