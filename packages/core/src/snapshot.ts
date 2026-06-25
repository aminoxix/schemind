import { shapesEqual } from './shape.js'
import type { ShapeNode } from './types.js'

/* -------------------------------------------------------------------------- */
/*  Snapshot model                                                            */
/* -------------------------------------------------------------------------- */

/** Who accepted a shape change, when, and why — the drift audit trail. */
export interface Acceptance {
  /** Identity of the accepter (e.g. a username or CI actor). */
  acceptedBy?: string
  /** ISO timestamp of acceptance. */
  acceptedAt: string
  /** Free-text rationale. */
  reason?: string
}

/** A superseded shape version, retained so teams can roll back to known-good. */
export interface SnapshotHistoryEntry {
  snapshotVersion: number
  shape: ShapeNode
  /** When this version was superseded. */
  recordedAt: string
  /** Backend adapter schema hash for this version, if it was known. */
  hash?: string
  /** The acceptance that originally promoted this shape to the baseline, if any. */
  acceptance?: Acceptance
}

/** The persisted record of an endpoint's current (and past) response shapes. */
export interface Snapshot {
  /** Normalized endpoint, e.g. `GET /api/users/:id`. */
  endpoint: string
  /** Incremented on every accepted shape change. */
  snapshotVersion: number
  /** ISO timestamp of first creation. */
  createdAt: string
  /** ISO timestamp of the most recent accepted change. */
  updatedAt: string
  /** The current shape. */
  shape: ShapeNode
  /** Backend adapter schema hash, if known (enables the hash fast-path). */
  hash?: string
  /** The acceptance that promoted the current shape, if it was an accepted drift. */
  acceptance?: Acceptance
  /** Prior versions, oldest first. */
  history: SnapshotHistoryEntry[]
}

/** Optional enrichment recorded alongside a committed shape. */
export interface CommitOptions {
  hash?: string
  /** Record who/why accepted this change. `acceptedAt` is stamped by the store's clock. */
  acceptance?: { acceptedBy?: string; reason?: string }
}

/** Outcome of {@link SnapshotStore.commit}. */
export interface CommitResult {
  snapshot: Snapshot
  /** True when no prior snapshot existed. */
  created: boolean
  /** True when the shape (or hash) differed and the snapshot was written. */
  changed: boolean
}

/* -------------------------------------------------------------------------- */
/*  Storage driver (pluggable)                                                */
/* -------------------------------------------------------------------------- */

/**
 * Raw persistence backend for snapshots. {@link MemoryStorageDriver} (default,
 * browser-safe) keeps records in a map; {@link LocalStorageDriver}
 * (`schemind/node`) writes JSON files; alternative drivers (s3, redis) implement
 * the same contract. Drivers deal only in whole {@link Snapshot} records —
 * versioning and history logic lives in {@link SnapshotStore}.
 */
export interface StorageDriver {
  /** Load a snapshot by endpoint, or `null` if none exists. */
  read(endpoint: string): Promise<Snapshot | null>
  /** Persist (create or overwrite) a snapshot. */
  write(snapshot: Snapshot): Promise<void>
  /** List the endpoints that have a stored snapshot. */
  list(): Promise<string[]>
  /** Remove a snapshot if present. */
  remove(endpoint: string): Promise<void>
}

/**
 * Encode an endpoint into a filesystem-safe filename.
 *
 * `GET /api/users/:id` → `GET__api_users__id__7f3a9c21`
 *
 * The readable slug is **lossy** (many characters collapse to `_`), so a short
 * deterministic hash of the *full* endpoint is appended to guarantee distinct
 * endpoints never share a file. Each snapshot record also stores its `endpoint`
 * field verbatim. Pure string logic — no platform dependencies.
 */
export function endpointToFilename(endpoint: string): string {
  const trimmed = endpoint.trim()
  const spaceIdx = trimmed.search(/\s/)
  const method = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)
  const path = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1).trim()
  const slugPath = path
    .replace(/^\//, '')
    .replace(/[/:]/g, '_')
    .replace(/[^A-Za-z0-9_]/g, '_')
  const slug = slugPath ? `${method}__${slugPath}` : method
  return `${slug}__${hash8(endpoint)}`
}

/** Deterministic 8-char hex hash (FNV-1a, 32-bit) for filename disambiguation. */
function hash8(input: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/** Options for {@link MemoryStorageDriver}. */
export interface MemoryStorageOptions {
  /**
   * Maximum number of endpoints retained. When exceeded, the least-recently-used
   * entry is evicted — a guard against unbounded growth when endpoint
   * normalization misses an id pattern (so every URL becomes its own key) in a
   * long-running process. Default `500`. Set `0`/`Infinity` to disable.
   */
  maxEntries?: number
}

const DEFAULT_MAX_ENTRIES = 500

/**
 * In-memory driver. The default — works in every runtime (browser, edge, Node)
 * and adds no I/O. Snapshots live only for the process lifetime; use
 * {@link LocalStorageDriver} (from `schemind/node`) to persist across runs.
 *
 * Bounded by an LRU cap so it can't leak in a long-lived session.
 */
export class MemoryStorageDriver implements StorageDriver {
  private readonly store = new Map<string, Snapshot>()
  private readonly maxEntries: number

  constructor(options: MemoryStorageOptions = {}) {
    const max = options.maxEntries ?? DEFAULT_MAX_ENTRIES
    this.maxEntries = max > 0 && Number.isFinite(max) ? max : Number.POSITIVE_INFINITY
  }

  read(endpoint: string): Promise<Snapshot | null> {
    const found = this.store.get(endpoint)
    if (found === undefined) return Promise.resolve(null)
    // Mark as most-recently-used.
    this.store.delete(endpoint)
    this.store.set(endpoint, found)
    // Defensive clone so callers can't mutate stored state by reference.
    return Promise.resolve(structuredClone(found))
  }

  write(snapshot: Snapshot): Promise<void> {
    this.store.delete(snapshot.endpoint) // reset recency
    this.store.set(snapshot.endpoint, structuredClone(snapshot))
    if (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value
      if (oldest !== undefined) this.store.delete(oldest)
    }
    return Promise.resolve()
  }

  list(): Promise<string[]> {
    return Promise.resolve([...this.store.keys()])
  }

  remove(endpoint: string): Promise<void> {
    this.store.delete(endpoint)
    return Promise.resolve()
  }
}

/* -------------------------------------------------------------------------- */
/*  Snapshot store (versioning + history orchestration)                       */
/* -------------------------------------------------------------------------- */

/** Injectable clock — returns an ISO-8601 timestamp. Overridable in tests. */
export type Clock = () => string

const systemClock: Clock = () => new Date().toISOString()

const DEFAULT_MAX_HISTORY = 50
/**
 * Absolute ceiling on retained history, enforced even when `maxHistory` is set
 * to "unlimited". Must match the validator's `MAX_HISTORY_LENGTH` so a written
 * snapshot always passes its own read-time validation.
 */
const HARD_MAX_HISTORY = 10_000

/** Options for {@link SnapshotStore}. */
export interface SnapshotStoreOptions {
  /**
   * Cap on retained `history` entries per snapshot. The oldest are dropped past
   * this — a volatile endpoint (new shape every deploy) can't grow a snapshot
   * without bound. Default `50`. Set `0`/`Infinity` to keep full history.
   */
  maxHistory?: number
}

/**
 * High-level snapshot API over a {@link StorageDriver}. Owns version increments,
 * history retention and the create-vs-update decision.
 */
export class SnapshotStore {
  private readonly driver: StorageDriver
  private readonly now: Clock
  private readonly maxHistory: number

  constructor(
    driver: StorageDriver = new MemoryStorageDriver(),
    now: Clock = systemClock,
    options: SnapshotStoreOptions = {},
  ) {
    this.driver = driver
    this.now = now
    const max = options.maxHistory ?? DEFAULT_MAX_HISTORY
    this.maxHistory = max > 0 && Number.isFinite(max) ? max : Number.POSITIVE_INFINITY
  }

  /** Load the current snapshot for an endpoint, or `null`. */
  load(endpoint: string): Promise<Snapshot | null> {
    return this.driver.read(endpoint)
  }

  /** List endpoints with a stored snapshot. */
  list(): Promise<string[]> {
    return this.driver.list()
  }

  /** Delete an endpoint's snapshot. */
  remove(endpoint: string): Promise<void> {
    return this.driver.remove(endpoint)
  }

  /**
   * Record a newly-observed shape for an endpoint.
   *
   * `snapshotVersion` tracks **shape** changes only:
   * - No prior snapshot → creates version 1.
   * - Shape unchanged → no version bump. If the hash differs it's updated in
   *   place (no history entry); otherwise it's a pure no-op.
   * - Shape changed → increments the version, archives the prior shape into
   *   `history`, and writes the new record.
   */
  async commit(
    endpoint: string,
    shape: ShapeNode,
    options: CommitOptions = {},
  ): Promise<CommitResult> {
    const ts = this.now()
    const acceptance = buildAcceptance(options, ts)
    const prev = await this.driver.read(endpoint)

    if (!prev) {
      const snapshot: Snapshot = {
        endpoint,
        snapshotVersion: 1,
        createdAt: ts,
        updatedAt: ts,
        shape,
        history: [],
        ...(options.hash !== undefined ? { hash: options.hash } : {}),
        ...(acceptance ? { acceptance } : {}),
      }
      await this.driver.write(snapshot)
      return { snapshot, created: true, changed: true }
    }

    // Shape unchanged: never bump the version or touch history. A differing hash
    // is recorded in place so the fast-path stays warm without inflating the
    // shape-change count.
    if (shapesEqual(prev.shape, shape)) {
      const sameHash = (prev.hash ?? undefined) === (options.hash ?? undefined)
      if (sameHash) return { snapshot: prev, created: false, changed: false }

      const snapshot: Snapshot = {
        ...prev,
        updatedAt: ts,
        ...(options.hash !== undefined ? { hash: options.hash } : {}),
      }
      // Clearing a previously-set hash: drop the field entirely.
      if (options.hash === undefined) delete snapshot.hash
      await this.driver.write(snapshot)
      return { snapshot, created: false, changed: false }
    }

    const archived: SnapshotHistoryEntry = {
      snapshotVersion: prev.snapshotVersion,
      shape: prev.shape,
      recordedAt: ts,
      ...(prev.hash !== undefined ? { hash: prev.hash } : {}),
      ...(prev.acceptance ? { acceptance: prev.acceptance } : {}),
    }
    const merged = [...prev.history, archived]
    // Always cap at the hard ceiling so writes never exceed what reads accept.
    const cap = Math.min(this.maxHistory, HARD_MAX_HISTORY)
    const history = merged.slice(-cap)
    const snapshot: Snapshot = {
      endpoint,
      snapshotVersion: prev.snapshotVersion + 1,
      createdAt: prev.createdAt,
      updatedAt: ts,
      shape,
      history,
      ...(options.hash !== undefined ? { hash: options.hash } : {}),
      ...(acceptance ? { acceptance } : {}),
    }
    await this.driver.write(snapshot)
    return { snapshot, created: false, changed: true }
  }
}

function buildAcceptance(options: CommitOptions, ts: string): Acceptance | undefined {
  if (!options.acceptance) return undefined
  const acceptance: Acceptance = { acceptedAt: ts }
  if (options.acceptance.acceptedBy !== undefined)
    acceptance.acceptedBy = options.acceptance.acceptedBy
  if (options.acceptance.reason !== undefined) acceptance.reason = options.acceptance.reason
  return acceptance
}
