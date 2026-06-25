'use client'

import { BackendSwitcher } from '@/components/BackendSwitcher'
import { BookCard } from '@/components/BookCard'
import { BookForm } from '@/components/BookForm'
import { type DriftEntry, DriftPanel } from '@/components/DriftPanel'
import { type BackendTarget, api } from '@/lib/api'
import { onObserve } from '@/lib/schemind'
import type { Book, DriftMode } from '@/lib/types'
import { BookOpen, Plus, RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

type Modal = { kind: 'create' } | { kind: 'edit'; book: Book } | null

const DRIFT_MODES: { value: DriftMode; label: string }[] = [
  { value: 'none', label: 'No drift' },
  { value: 'info', label: 'Info — add field' },
  { value: 'warn', label: 'Warn — nullable' },
  { value: 'breaking', label: 'Breaking — rename' },
]

export default function HomePage() {
  const [backend, setBackend] = useState<BackendTarget>('go')
  const [books, setBooks] = useState<Book[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modal, setModal] = useState<Modal>(null)
  const [drift, setDrift] = useState<DriftMode>('none')
  const [entries, setEntries] = useState<DriftEntry[]>([])
  const entryId = useRef(0)

  // Subscribe to every schemind observation and surface drift in the panel.
  useEffect(() => {
    return onObserve((result) => {
      // Ignore "no change" observations; show baselines and real drift.
      if (!result.created && (result.report?.changes.length ?? 0) === 0) return
      setEntries((prev) =>
        [
          {
            id: entryId.current++,
            endpoint: result.endpoint,
            report: result.report,
            created: result.created,
            at: new Date().toISOString(),
          },
          ...prev,
        ].slice(0, 25),
      )
    })
  }, [])

  const fetchBooks = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.listBooks(backend)
      setBooks(res.data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch books')
    } finally {
      setLoading(false)
    }
  }, [backend])

  useEffect(() => {
    fetchBooks()
  }, [fetchBooks])

  async function handleCreate(payload: Parameters<typeof api.createBook>[1]) {
    await api.createBook(backend, payload)
    setModal(null)
    fetchBooks()
  }

  async function handleUpdate(payload: Parameters<typeof api.createBook>[1]) {
    if (modal?.kind !== 'edit') return
    await api.updateBook(backend, modal.book.id, payload)
    setModal(null)
    fetchBooks()
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this book?')) return
    await api.deleteBook(backend, id)
    fetchBooks()
  }

  async function handleDriftChange(mode: DriftMode) {
    setDrift(mode)
    await api.setDrift(backend, mode)
    fetchBooks()
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="bg-white border-b border-zinc-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <BookOpen size={20} className="text-zinc-700" />
            <h1 className="font-semibold text-zinc-900">Book Library</h1>
            <span className="text-xs text-zinc-400 bg-zinc-100 px-2 py-0.5 rounded-full">
              schemind test harness
            </span>
          </div>
          <BackendSwitcher
            current={backend}
            onChange={(b) => {
              // Each backend has its own drift state and its own snapshot keys
              // (keyed by origin), so reset the selector and panel on switch.
              setBackend(b)
              setDrift('none')
              setEntries([])
            }}
          />
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-[1fr_20rem] gap-8">
        <section>
          <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
            <p className="text-sm text-zinc-500">
              {loading ? 'Loading…' : `${books.length} book${books.length !== 1 ? 's' : ''}`}
            </p>
            <div className="flex gap-2 items-center">
              <label className="flex items-center gap-1.5 text-sm text-zinc-500">
                Drift
                <select
                  data-testid="drift-mode"
                  value={drift}
                  onChange={(e) => handleDriftChange(e.target.value as DriftMode)}
                  className="border border-zinc-200 rounded-lg px-2 py-1.5 text-sm bg-white"
                >
                  {DRIFT_MODES.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                onClick={fetchBooks}
                data-testid="refresh"
                className="flex items-center gap-1.5 px-3 py-2 text-sm border border-zinc-200 rounded-lg text-zinc-600 hover:bg-zinc-100"
              >
                <RotateCcw size={14} />
                Refresh
              </button>
              <button
                onClick={() => setModal({ kind: 'create' })}
                data-testid="add-book"
                className="flex items-center gap-1.5 px-3 py-2 text-sm bg-zinc-900 text-white rounded-lg hover:bg-zinc-700"
              >
                <Plus size={14} />
                Add Book
              </button>
            </div>
          </div>

          {error && (
            <div
              data-testid="error"
              className="mb-6 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700"
            >
              {error} — is the {backend === 'go' ? 'Go (:8080)' : 'Java (:8081)'} backend running?
            </div>
          )}

          {!loading && !error && books.length === 0 && (
            <div className="text-center py-20 text-zinc-400 text-sm">No books yet. Add one!</div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {books.map((book) => (
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
        <BookForm onSubmit={handleCreate} onCancel={() => setModal(null)} />
      )}
      {modal?.kind === 'edit' && (
        <BookForm initial={modal.book} onSubmit={handleUpdate} onCancel={() => setModal(null)} />
      )}
    </div>
  )
}
