import { describe, expect, it } from 'vitest'
import { createFixture, parseFixture } from '../src/fixture.js'
import { object, scalar } from '../src/shape.js'
import { SchemindValidationError } from '../src/validate.js'

describe('fixtures (F10)', () => {
  const entries = [{ endpoint: 'GET /api/books', shape: object({ id: scalar('number') }) }]

  it('creates a values-free fixture', () => {
    const f = createFixture(entries, '2026-01-01T00:00:00.000Z')
    expect(f.version).toBe(1)
    expect(f.recordedAt).toBe('2026-01-01T00:00:00.000Z')
    expect(f.shapes['GET /api/books']).toEqual(object({ id: scalar('number') }))
  })

  it('round-trips through JSON', () => {
    const f = createFixture(entries, '2026-01-01T00:00:00.000Z')
    expect(parseFixture(JSON.parse(JSON.stringify(f)))).toEqual(f)
  })

  it('rejects malformed fixtures', () => {
    expect(() => parseFixture(null)).toThrow(SchemindValidationError)
    expect(() => parseFixture({ version: 2 })).toThrow(SchemindValidationError)
    expect(() => parseFixture({ version: 1 })).toThrow(SchemindValidationError) // no shapes
    expect(() => parseFixture({ version: 1, shapes: { 'GET /x': { kind: 'bad' } } })).toThrow(
      SchemindValidationError,
    )
  })
})
