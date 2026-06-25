import { describe, expect, it } from 'vitest'
import { normalizeEndpoint, normalizePath, originOf, pathOf } from '../src/normalize.js'

describe('pathOf', () => {
  it('extracts the pathname from absolute URLs and drops query/hash', () => {
    expect(pathOf('http://localhost:8080/api/books?sort=asc#x')).toBe('/api/books')
  })

  it('handles relative URLs', () => {
    expect(pathOf('/api/books?x=1')).toBe('/api/books')
    expect(pathOf('api/books')).toBe('/api/books')
  })
})

describe('originOf', () => {
  it('returns the origin for absolute URLs', () => {
    expect(originOf('http://localhost:8080/api/books')).toBe('http://localhost:8080')
    expect(originOf('https://api.example.com/x')).toBe('https://api.example.com')
  })

  it('returns empty string for relative URLs', () => {
    expect(originOf('/api/books')).toBe('')
    expect(originOf('api/books')).toBe('')
  })
})

describe('normalizePath', () => {
  it('collapses numeric ids to :id', () => {
    expect(normalizePath('/api/books/123')).toBe('/api/books/:id')
    expect(normalizePath('/api/users/42/posts/99')).toBe('/api/users/:id/posts/:id')
  })

  it('collapses UUIDs to :id', () => {
    expect(normalizePath('/api/books/3f2504e0-4f89-41d3-9a0c-0305e82c3301')).toBe('/api/books/:id')
  })

  it('leaves param-free paths untouched', () => {
    expect(normalizePath('/api/books')).toBe('/api/books')
  })
})

describe('normalizeEndpoint', () => {
  it('upper-cases the method and keeps relative paths origin-free', () => {
    expect(normalizeEndpoint('POST', '/api/auth/login')).toBe('POST /api/auth/login')
    expect(normalizeEndpoint('get', '/api/books/7')).toBe('GET /api/books/:id')
  })

  it('includes the origin for absolute URLs by default', () => {
    expect(normalizeEndpoint('get', 'http://localhost:8080/api/books/7')).toBe(
      'GET http://localhost:8080/api/books/:id',
    )
  })

  it('keeps different hosts in separate keys (no cross-host collision)', () => {
    const a = normalizeEndpoint('GET', 'https://api-a.com/api/users/1')
    const b = normalizeEndpoint('GET', 'https://api-b.com/api/users/2')
    expect(a).not.toBe(b)
    expect(a).toBe('GET https://api-a.com/api/users/:id')
  })

  it('can merge hosts when includeOrigin is false', () => {
    expect(
      normalizeEndpoint('GET', 'http://localhost:8080/api/books/7', { includeOrigin: false }),
    ).toBe('GET /api/books/:id')
  })
})
