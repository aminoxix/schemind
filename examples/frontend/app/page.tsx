'use client'

import { BackendSwitcher } from '@/components/backend-switcher'
import { BookCard } from '@/components/book-card'
import { BookForm } from '@/components/book-form'
import { type DriftEntry, DriftPanel } from '@/components/drift-panel'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useBooks, useCreateBook, useDeleteBook, useSetDrift, useUpdateBook } from '@/lib/queries'
import { onObserve } from '@/lib/schemind'
import type { BackendTarget, Book, BookInput, DriftMode } from '@/lib/types'
import { BookOpen, Plus, RotateCcw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

type Modal = { kind: 'create' } | { kind: 'edit'; book: Book } | null

const DRIFT_MODES: { value: DriftMode; label: string }[] = [
  { value: 'none', label: 'No drift' },
  { value: 'info', label: 'Info — add field' },
  { value: 'warn', label: 'Warn — nullable' },
  { value: 'breaking', label: 'Breaking — rename' },
]

export default function HomePage() {
  const [backend, setBackend] = useState<BackendTarget>('go')
  const [modal, setModal] = useState<Modal>(null)
  const [drift, setDrift] = useState<DriftMode>('none')
  const [entries, setEntries] = useState<DriftEntry[]>([])
  const entryId = useRef(0)

  const books = useBooks(backend)
  const createBook = useCreateBook(backend)
  const updateBook = useUpdateBook(backend)
  const deleteBook = useDeleteBook(backend)
  const setDriftMode = useSetDrift(backend)

  const list = books.data ?? []

  // Subscribe to every schemind observation and surface drift in the panel.
  useEffect(() => {
    return onObserve((result, source) => {
      // Ignore "no change" observations; show baselines and real drift.
      if (!result.created && (result.report?.changes.length ?? 0) === 0) return
      setEntries((prev) =>
        [
          {
            id: entryId.current++,
            endpoint: result.endpoint,
            report: result.report,
            created: result.created,
            source,
            at: new Date().toISOString(),
          },
          ...prev,
        ].slice(0, 25),
      )
    })
  }, [])

  function switchBackend(next: BackendTarget) {
    // Each backend has its own drift state and its own snapshot keys (keyed by
    // origin), so reset the selector and panel on switch.
    setBackend(next)
    setDrift('none')
    setEntries([])
  }

  async function handleCreate(payload: BookInput) {
    await createBook.mutateAsync(payload)
    setModal(null)
  }

  async function handleUpdate(payload: BookInput) {
    if (modal?.kind !== 'edit') return
    await updateBook.mutateAsync({ id: modal.book.id, input: payload })
    setModal(null)
  }

  function handleDelete(id: string) {
    if (!confirm('Delete this book?')) return
    deleteBook.mutate(id)
  }

  async function handleDriftChange(mode: DriftMode) {
    setDrift(mode)
    await setDriftMode.mutateAsync(mode)
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="sticky top-0 z-10 border-zinc-200 border-b bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-2">
            <BookOpen size={20} className="text-zinc-700" />
            <h1 className="font-semibold text-zinc-900">Book Library</h1>
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-400">
              schemind test harness
            </span>
          </div>
          <BackendSwitcher value={backend} onChange={switchBackend} />
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl grid-cols-1 gap-8 px-6 py-8 lg:grid-cols-[1fr_20rem]">
        <section>
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-zinc-500">
              {books.isLoading ? 'Loading…' : `${list.length} book${list.length !== 1 ? 's' : ''}`}
            </p>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-sm text-zinc-500">
                Drift
                <Select value={drift} onValueChange={(v) => handleDriftChange(v as DriftMode)}>
                  <SelectTrigger
                    data-testid="drift-mode"
                    className="w-[180px]"
                    aria-label="Drift mode"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DRIFT_MODES.map((m) => (
                      <SelectItem
                        key={m.value}
                        value={m.value}
                        data-testid={`drift-mode-${m.value}`}
                      >
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <Button variant="outline" data-testid="refresh" onClick={() => books.refetch()}>
                <RotateCcw size={14} />
                Refresh
              </Button>
              <Button data-testid="add-book" onClick={() => setModal({ kind: 'create' })}>
                <Plus size={14} />
                Add Book
              </Button>
            </div>
          </div>

          {books.error && (
            <div
              data-testid="error"
              className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-700 text-sm"
            >
              {books.error.message} — is the {backend === 'go' ? 'Go (:8080)' : 'Java (:8081)'}{' '}
              backend running?
            </div>
          )}

          {!books.isLoading && !books.error && list.length === 0 && (
            <div className="py-20 text-center text-sm text-zinc-400">No books yet. Add one!</div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {list.map((book) => (
              <BookCard
                key={book.id}
                book={book}
                onEdit={(b) => setModal({ kind: 'edit', book: b })}
                onDelete={handleDelete}
              />
            ))}
          </div>
        </section>

        <DriftPanel entries={entries} onClear={() => setEntries([])} />
      </main>

      {modal?.kind === 'create' && (
        <BookForm
          open
          onOpenChange={(o) => !o && setModal(null)}
          onSubmit={handleCreate}
          submitting={createBook.isPending}
        />
      )}
      {modal?.kind === 'edit' && (
        <BookForm
          open
          onOpenChange={(o) => !o && setModal(null)}
          initial={modal.book}
          onSubmit={handleUpdate}
          submitting={updateBook.isPending}
        />
      )}
    </div>
  )
}
