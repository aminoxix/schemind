'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { booksApi, runApi } from './api'
import type { BackendTarget, BookInput, DriftMode } from './types'

const booksKey = (backend: BackendTarget) => ['books', backend] as const

export function useBooks(backend: BackendTarget) {
  return useQuery({
    queryKey: booksKey(backend),
    queryFn: () => runApi(booksApi.list(backend)),
    select: (res) => res.data,
  })
}

export function useCreateBook(backend: BackendTarget) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: BookInput) => runApi(booksApi.create(backend, input)),
    onSuccess: () => qc.invalidateQueries({ queryKey: booksKey(backend) }),
  })
}

export function useUpdateBook(backend: BackendTarget) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: BookInput }) =>
      runApi(booksApi.update(backend, id, input)),
    onSuccess: () => qc.invalidateQueries({ queryKey: booksKey(backend) }),
  })
}

export function useDeleteBook(backend: BackendTarget) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => runApi(booksApi.remove(backend, id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: booksKey(backend) }),
  })
}

export function useSetDrift(backend: BackendTarget) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (mode: DriftMode) => runApi(booksApi.setDrift(backend, mode)),
    onSuccess: () => qc.invalidateQueries({ queryKey: booksKey(backend) }),
  })
}
