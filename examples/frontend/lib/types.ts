import { z } from 'zod'

/**
 * Schemas are the single source of truth — every type is `z.infer`'d from these,
 * so the runtime guard and the static type can never drift apart.
 *
 * The book schema is deliberately **lenient**: the demo backend mutates its own
 * response shape (the whole point), so `author` may be missing (breaking drift),
 * `rating` may be null (warn), and `genre`/`authorInfo` may appear (info/breaking).
 * Decoding stays green across every drift mode — schemind reports the drift,
 * the UI degrades gracefully.
 */
export const authorSchema = z.object({
  name: z.string(),
  country: z.string(),
})
export type Author = z.infer<typeof authorSchema>

export const bookSchema = z.object({
  id: z.string(),
  title: z.string(),
  author: authorSchema.optional(), // absent under "breaking" drift
  authorInfo: authorSchema.optional(), // present under "breaking" drift
  tags: z.array(z.string()).default([]),
  rating: z.number().nullable().optional(), // null under "warn" drift
  publishedAt: z.string().nullable().optional(),
  createdAt: z.string().optional(),
  genre: z.string().optional(), // present under "info" drift
})
export type Book = z.infer<typeof bookSchema>

export const booksResponseSchema = z.object({ data: z.array(bookSchema), count: z.number() })
export const bookResponseSchema = z.object({ data: bookSchema })
export const deleteResponseSchema = z.object({ data: z.object({ id: z.string() }) })

export const driftModeSchema = z.enum(['none', 'breaking', 'warn', 'info'])
export type DriftMode = z.infer<typeof driftModeSchema>
export const driftResponseSchema = z.object({ drift: driftModeSchema })

export const backendTargetSchema = z.enum(['go', 'java'])
export type BackendTarget = z.infer<typeof backendTargetSchema>

/** Strict input schema for the create/update form (TanStack Form + Zod). */
export const bookFormSchema = z.object({
  title: z.string().trim().min(1, 'Title is required'),
  authorName: z.string().trim().min(1, 'Author is required'),
  country: z.string().trim(),
  tags: z.string(),
  rating: z.number().min(0, 'Min 0').max(5, 'Max 5'),
})
export type BookFormValues = z.infer<typeof bookFormSchema>

/** The payload the API expects (mapped from the flat form values). */
export interface BookInput {
  title: string
  author: Author
  tags: string[]
  rating: number
}

export function toBookInput(v: BookFormValues): BookInput {
  return {
    title: v.title.trim(),
    author: { name: v.authorName.trim(), country: v.country.trim() },
    tags: v.tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
    rating: v.rating,
  }
}
