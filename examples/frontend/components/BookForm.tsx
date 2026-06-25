'use client'

import type { Book, BookInput } from '@/lib/types'
import { X } from 'lucide-react'
import { useState } from 'react'

export function BookForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial?: Book
  onSubmit: (payload: BookInput) => void | Promise<void>
  onCancel: () => void
}) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [authorName, setAuthorName] = useState(initial?.author?.name ?? '')
  const [country, setCountry] = useState(initial?.author?.country ?? '')
  const [tags, setTags] = useState((initial?.tags ?? []).join(', '))
  const [rating, setRating] = useState(String(initial?.rating ?? 4))
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await onSubmit({
        title: title.trim(),
        author: { name: authorName.trim(), country: country.trim() },
        tags: tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        rating: Number(rating) || 0,
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-20">
      <form
        onSubmit={submit}
        data-testid="book-form"
        className="bg-white rounded-xl w-full max-w-md p-6 flex flex-col gap-4"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-zinc-900">{initial ? 'Edit book' : 'Add book'}</h2>
          <button type="button" onClick={onCancel} className="text-zinc-400 hover:text-zinc-700">
            <X size={18} />
          </button>
        </div>

        <Field label="Title">
          <input
            data-testid="field-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            className="input"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Author">
            <input
              data-testid="field-author"
              value={authorName}
              onChange={(e) => setAuthorName(e.target.value)}
              required
              className="input"
            />
          </Field>
          <Field label="Country">
            <input value={country} onChange={(e) => setCountry(e.target.value)} className="input" />
          </Field>
        </div>

        <Field label="Tags (comma separated)">
          <input value={tags} onChange={(e) => setTags(e.target.value)} className="input" />
        </Field>

        <Field label="Rating">
          <input
            type="number"
            step="0.1"
            min="0"
            max="5"
            value={rating}
            onChange={(e) => setRating(e.target.value)}
            className="input"
          />
        </Field>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-100 rounded-lg"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            data-testid="submit-book"
            className="px-3 py-2 text-sm bg-zinc-900 text-white rounded-lg hover:bg-zinc-700 disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-zinc-600">{label}</span>
      {children}
    </label>
  )
}
