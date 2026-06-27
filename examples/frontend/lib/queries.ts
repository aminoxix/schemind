'use client'

// Demonstrates the granular @aminoxix/schemind/tanstack integration patterns.
// Each observed call is tagged source: 'tanstack' (via notifyTanstack) so the
// DriftPanel can badge it distinctly from the transport-level schemindFetch path.
//
//  useBooks               → useSchemindQuery    (per-query hook with select)
//  useCreateBook          → useSchemindMutation (POST, observes request + response)
//  useUpdateBook          → useSchemindMutation (PUT)
//  useDeleteBook          → wrapQueryFn         (low-level utility inside useMutation)
//  useSetDrift            → plain useMutation   (internal control — intentionally unobserved)
//
// The zero-config `createSchemindQueryClient` (whole-client auto-observe) is
// documented in the README; it's omitted here because it can't derive clean
// endpoints from this app's cache keys and would double-observe on a shared engine.

import { useSchemindMutation, useSchemindQuery, wrapQueryFn } from '@aminoxix/schemind/tanstack'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { booksApi, runApi } from './api'
import { engine, notifyTanstack } from './schemind'
import type { BackendTarget, BookInput, DriftMode } from './types'

const booksKey = (backend: BackendTarget) => ['books', backend] as const

// ─── useSchemindQuery ─────────────────────────────────────────────────────────
// Drop-in for useQuery. Observes the raw response shape before `select`
// transforms it into the final data type.

export function useBooks(backend: BackendTarget) {
  return useSchemindQuery({
    queryKey: booksKey(backend),
    queryFn: () => runApi(booksApi.list(backend)),
    endpoint: 'GET /api/books',
    engine,
    onObserve: notifyTanstack,
    // `select` is fully typed: TQueryFnData = BooksResponse, TData = Book[]
    select: (res) => res.data,
  })
}

// ─── useSchemindMutation (POST) ───────────────────────────────────────────────
// Observes both the BookInput request body and the created Book response.

export function useCreateBook(backend: BackendTarget) {
  const qc = useQueryClient()
  return useSchemindMutation({
    endpoint: 'POST /api/books',
    engine,
    method: 'POST',
    onObserve: notifyTanstack,
    mutationFn: (input: BookInput) => runApi(booksApi.create(backend, input)),
    onSuccess: () => qc.invalidateQueries({ queryKey: booksKey(backend) }),
  })
}

// ─── useSchemindMutation (PUT) ────────────────────────────────────────────────
// Same hook, different method — schemind tracks request + response separately
// per method so PUT /api/books/:id gets its own baseline.

export function useUpdateBook(backend: BackendTarget) {
  const qc = useQueryClient()
  return useSchemindMutation({
    endpoint: 'PUT /api/books/:id',
    engine,
    method: 'PUT',
    onObserve: notifyTanstack,
    mutationFn: ({ id, input }: { id: string; input: BookInput }) =>
      runApi(booksApi.update(backend, id, input)),
    onSuccess: () => qc.invalidateQueries({ queryKey: booksKey(backend) }),
  })
}

// ─── wrapQueryFn ─────────────────────────────────────────────────────────────
// Low-level utility — wraps any `() => Promise<T>` with schemind observation.
// Useful when you can't use the hook API (e.g. inside a plain useMutation,
// or in a non-React context like a loader or server action).

export function useDeleteBook(backend: BackendTarget) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      // wrapQueryFn wraps a zero-arg function and returns an observed version.
      // We invoke it immediately (trailing `()`) to get the Promise.
      wrapQueryFn('DELETE /api/books/:id', () => runApi(booksApi.remove(backend, id)), {
        engine,
        method: 'DELETE',
        onObserve: notifyTanstack,
      })(),
    onSuccess: () => qc.invalidateQueries({ queryKey: booksKey(backend) }),
  })
}

// ─── plain useMutation ────────────────────────────────────────────────────────
// Drift control is an internal demo endpoint — intentionally not observed so it
// doesn't pollute the shape baselines with control-plane traffic.

export function useSetDrift(backend: BackendTarget) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (mode: DriftMode) => runApi(booksApi.setDrift(backend, mode)),
    onSuccess: () => qc.invalidateQueries({ queryKey: booksKey(backend) }),
  })
}
