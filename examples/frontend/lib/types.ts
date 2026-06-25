export interface Author {
  name: string
  country: string
}

export interface Book {
  id: string
  title: string
  author: Author
  tags: string[]
  rating: number
  publishedAt: string | null
  createdAt: string
  // Present only when the backend is in "breaking" drift mode (author renamed).
  authorInfo?: Author
  // Present only in "info" drift mode.
  genre?: string
}

/** Payload for create/update. */
export interface BookInput {
  title: string
  author: Author
  tags: string[]
  rating: number
}

export type DriftMode = 'none' | 'breaking' | 'warn' | 'info'
