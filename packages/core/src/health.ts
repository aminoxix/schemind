import type { Acceptance, Snapshot } from './snapshot.js'

/** A per-endpoint stability summary derived from its snapshot history. */
export interface EndpointHealth {
  endpoint: string
  /** Current snapshot version (1 = never changed since baseline). */
  version: number
  /** Number of accepted shape changes (`version - 1`). */
  changes: number
  createdAt: string
  updatedAt: string
  /** Age of the baseline in days. */
  ageDays: number
  /** Shape changes per week over the baseline's lifetime. */
  changesPerWeek: number
  /** Stability score, 0–100 (higher = more stable). */
  score: number
  /** The most recent acceptance, if any. */
  lastAcceptance?: Acceptance
}

const DAY_MS = 86_400_000
const WEEK_MS = 7 * DAY_MS

/**
 * Score an endpoint's stability from its snapshot. Frequent shape changes drive
 * the score down, so the least-stable endpoints surface first in `schm status`.
 */
export function endpointHealth(snapshot: Snapshot, nowMs: number = Date.now()): EndpointHealth {
  const changes = Math.max(0, snapshot.snapshotVersion - 1)
  const createdMs = Date.parse(snapshot.createdAt)
  const ageMs = Number.isFinite(createdMs) ? Math.max(0, nowMs - createdMs) : 0
  const ageDays = ageMs / DAY_MS
  // Use at least a day of window so a brand-new, twice-changed endpoint isn't
  // scored as infinitely unstable.
  const weeks = Math.max(ageMs, DAY_MS) / WEEK_MS
  const changesPerWeek = changes / weeks
  const score = Math.round(100 / (1 + changesPerWeek))

  return {
    endpoint: snapshot.endpoint,
    version: snapshot.snapshotVersion,
    changes,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
    ageDays: Math.round(ageDays * 10) / 10,
    changesPerWeek: Math.round(changesPerWeek * 100) / 100,
    score: Math.max(0, Math.min(100, score)),
    ...(snapshot.acceptance ? { lastAcceptance: snapshot.acceptance } : {}),
  }
}

/** Health for many snapshots, least-stable first. */
export function rankEndpointHealth(
  snapshots: readonly Snapshot[],
  nowMs: number = Date.now(),
): EndpointHealth[] {
  return snapshots.map((s) => endpointHealth(s, nowMs)).sort((a, b) => a.score - b.score)
}

/** A baseline not updated within the staleness window. */
export interface StaleEndpoint {
  endpoint: string
  ageDays: number
  updatedAt: string
}

/**
 * Find baselines whose last change (`updatedAt`) is older than `maxAgeMs` —
 * candidates for `schm gc` to flag or prune (zombie routes). Oldest first.
 */
export function staleEndpoints(
  snapshots: readonly Snapshot[],
  maxAgeMs: number,
  nowMs: number = Date.now(),
): StaleEndpoint[] {
  const out: StaleEndpoint[] = []
  for (const s of snapshots) {
    const updated = Date.parse(s.updatedAt)
    const age = Number.isFinite(updated) ? nowMs - updated : Number.POSITIVE_INFINITY
    if (age > maxAgeMs) {
      out.push({
        endpoint: s.endpoint,
        ageDays: Math.round((age / 86_400_000) * 10) / 10,
        updatedAt: s.updatedAt,
      })
    }
  }
  return out.sort((a, b) => b.ageDays - a.ageDays)
}
