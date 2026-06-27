'use client'

// Browser-side schemind integration for the demo.
//
// One shared engine, two observation paths — each tagged with a `source` so the
// DriftPanel can badge them:
//   1. schemindFetch — wraps native fetch (transport layer). Keys observations
//      by the absolute request URL, e.g. `GET http://localhost:8080/api/books`.
//      Tagged source 'fetch'.
//   2. The @aminoxix/schemind/tanstack hooks (lib/queries.ts) — observe each
//      query/mutation under its explicit relative endpoint, e.g. `GET /api/books`.
//      Tagged source 'tanstack' via notifyTanstack.
// The two paths use different endpoint keys (absolute vs relative) by design, so
// each integration keeps its own baseline and the panel shows both, side by side.
import { type ObserveResult, createSchemind, createSchemindFetch } from '@aminoxix/schemind'

/** Shared engine — passed to both schemindFetch and the TanStack hooks. */
export const engine = createSchemind()

/** Which integration produced an observation — drives the DriftPanel badge. */
export type ObserveSource = 'fetch' | 'tanstack'

type Listener = (result: ObserveResult, source: ObserveSource) => void
const listeners = new Set<Listener>()

/** Subscribe to every observation (from any path). Returns an unsubscribe fn. */
export function onObserve(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Broadcast an observation, tagged with the integration that produced it. */
export function notifyObservers(result: ObserveResult, source: ObserveSource): void {
  for (const listener of listeners) listener(result, source)
}

/** Curried broadcaster for the TanStack hooks' `onObserve` option. */
export const notifyTanstack = (result: ObserveResult): void => notifyObservers(result, 'tanstack')

/** A drop-in fetch that learns and watches every JSON response shape. */
export const schemindFetch = createSchemindFetch({
  engine,
  onObserve: (result) => notifyObservers(result, 'fetch'),
})

export type { ObserveResult } from '@aminoxix/schemind'
export type { DriftReport, DriftChange } from '@aminoxix/schemind'
