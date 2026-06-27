'use client'

import { Button } from '@/components/ui/button'
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
  // Read *only* the canonical `author` field. Under "breaking" drift the backend
  // renames `author` → `authorInfo`, so this becomes undefined and the card shows
  // "— unknown author —" — the break is visible in the UI, exactly as schemind
  // flags it in the drift panel. (No silent `?? authorInfo` fallback that would
  // paper over the rename.)
  const author = book.author

  return (
    <div
      data-testid="book-card"
      className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 data-testid="book-title" className="truncate font-medium text-zinc-900">
            {book.title}
          </h3>
          <p data-testid="book-author" className="truncate text-sm text-zinc-500">
            {author?.name ?? '— unknown author —'}
            {author?.country ? ` · ${author.country}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1 text-amber-500">
          <Star size={14} fill="currentColor" />
          <span className="text-sm text-zinc-700">
            {typeof book.rating === 'number' ? book.rating.toFixed(1) : '—'}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        {(book.tags ?? []).map((tag) => (
          <span key={tag} className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600">
            {tag}
          </span>
        ))}
        {book.genre && (
          <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs text-violet-700">
            {book.genre}
          </span>
        )}
      </div>

      <div className="flex gap-1 pt-1">
        <Button variant="ghost" size="sm" onClick={() => onEdit(book)}>
          <Pencil size={12} /> Edit
        </Button>
        <Button variant="destructive" size="sm" onClick={() => onDelete(book.id)}>
          <Trash2 size={12} /> Delete
        </Button>
      </div>
    </div>
  )
}
