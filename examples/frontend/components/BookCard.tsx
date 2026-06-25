'use client'

import type { Book } from '@/lib/types'
import { Pencil, Star, Trash2 } from 'lucide-react'

export function BookCard({
  book,
  onEdit,
  onDelete,
}: {
  book: Book
  onEdit: (book: Book) => void
  onDelete: (id: string) => void
}) {
  // Defensive: under "breaking" drift the backend renames `author` → `authorInfo`,
  // so `author` can be undefined. schemind flags this *before* it bites you here.
  const author = book.author ?? book.authorInfo

  return (
    <div
      data-testid="book-card"
      className="bg-white rounded-xl border border-zinc-200 p-4 flex flex-col gap-3"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 data-testid="book-title" className="font-medium text-zinc-900 truncate">
            {book.title}
          </h3>
          <p className="text-sm text-zinc-500 truncate">
            {author?.name ?? '— unknown author —'}
            {author?.country ? ` · ${author.country}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-1 text-amber-500 shrink-0">
          <Star size={14} fill="currentColor" />
          <span className="text-sm text-zinc-700">
            {typeof book.rating === 'number' ? book.rating.toFixed(1) : '—'}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        {(book.tags ?? []).map((tag) => (
          <span key={tag} className="text-xs bg-zinc-100 text-zinc-600 px-2 py-0.5 rounded-full">
            {tag}
          </span>
        ))}
        {book.genre && (
          <span className="text-xs bg-violet-100 text-violet-700 px-2 py-0.5 rounded-full">
            {book.genre}
          </span>
        )}
      </div>

      <div className="flex gap-2 pt-1">
        <button
          onClick={() => onEdit(book)}
          className="flex items-center gap-1 text-xs text-zinc-600 hover:text-zinc-900"
        >
          <Pencil size={12} /> Edit
        </button>
        <button
          onClick={() => onDelete(book.id)}
          className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700"
        >
          <Trash2 size={12} /> Delete
        </button>
      </div>
    </div>
  )
}
