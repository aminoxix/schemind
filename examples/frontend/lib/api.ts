'use client'

import { schemindFetch } from './schemind'
import type { Book, BookInput, DriftMode } from './types'

export type BackendTarget = 'go' | 'java'

const BASE_URL: Record<BackendTarget, string> = {
  go: process.env.NEXT_PUBLIC_GO_URL ?? 'http://localhost:8080',
  java: process.env.NEXT_PUBLIC_JAVA_URL ?? 'http://localhost:8081',
}

async function request<T>(
  backend: BackendTarget,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await schemindFetch(`${BASE_URL[backend]}${path}`, {
    method,
    ...(body !== undefined
      ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  })
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}`)
  return (await res.json()) as T
}

export const api = {
  listBooks: (backend: BackendTarget) =>
    request<{ data: Book[]; count: number }>(backend, 'GET', '/api/books'),

  createBook: (backend: BackendTarget, payload: BookInput) =>
    request<{ data: Book }>(backend, 'POST', '/api/books', payload),

  updateBook: (backend: BackendTarget, id: string, payload: BookInput) =>
    request<{ data: Book }>(backend, 'PUT', `/api/books/${id}`, payload),

  deleteBook: (backend: BackendTarget, id: string) =>
    request<{ data: { id: string } }>(backend, 'DELETE', `/api/books/${id}`),

  /** Test/demo control: flip the backend's response shape to simulate drift. */
  setDrift: (backend: BackendTarget, mode: DriftMode) =>
    request<{ drift: DriftMode }>(backend, 'POST', `/api/_drift?mode=${mode}`),
}
