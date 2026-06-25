'use client'

// Browser-side schemind integration for the demo.
//
// One in-memory engine instruments every API call through a wrapped `fetch`.
// Observations are broadcast to subscribers (the DriftPanel) so detected drift
// shows up live in the UI — without any backend changes.
import { type ObserveResult, createSchemind, createSchemindFetch } from 'schemind'

const engine = createSchemind()

type Listener = (result: ObserveResult) => void
const listeners = new Set<Listener>()

/** Subscribe to every observation. Returns an unsubscribe fn. */
export function onObserve(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** A drop-in fetch that learns and watches every JSON response shape. */
export const schemindFetch = createSchemindFetch({
  engine,
  onObserve: (result) => {
    for (const listener of listeners) listener(result)
  },
})

export type { ObserveResult } from 'schemind'
export type { DriftReport } from 'schemind'
