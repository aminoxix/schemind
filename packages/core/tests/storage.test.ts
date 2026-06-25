import { describe, expect, it } from 'vitest'
import { object, scalar } from '../src/shape.js'
import type { Snapshot } from '../src/snapshot.js'
import { JsonStorageDriver, type RawRecord } from '../src/storage/base.js'
import { SchemindValidationError } from '../src/validate.js'

/**
 * A throwaway custom driver — the kind a user might write for Redis/S3/IndexedDB.
 * It implements only raw text I/O; serialization and read-time validation are
 * inherited from {@link JsonStorageDriver}.
 */
class MapJsonDriver extends JsonStorageDriver {
  readonly store = new Map<string, string>()

  protected readText(endpoint: string): Promise<string | null> {
    return Promise.resolve(this.store.get(endpoint) ?? null)
  }
  protected writeText(endpoint: string, serialized: string): Promise<void> {
    this.store.set(endpoint, serialized)
    return Promise.resolve()
  }
  protected deleteText(endpoint: string): Promise<void> {
    this.store.delete(endpoint)
    return Promise.resolve()
  }
  protected readAllText(): Promise<RawRecord[]> {
    return Promise.resolve([...this.store.entries()].map(([id, text]) => ({ id, text })))
  }
}

const snapshot: Snapshot = {
  endpoint: 'GET /api/x',
  snapshotVersion: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  shape: object({ id: scalar('number') }),
  history: [],
}

describe('JsonStorageDriver (inherited behavior for custom drivers)', () => {
  it('round-trips write → read → list → remove', async () => {
    const driver = new MapJsonDriver()
    await driver.write(snapshot)

    // Stored as canonical JSON (pretty-printed, trailing newline) by the base.
    const text = driver.store.get('GET /api/x')
    expect(text?.endsWith('\n')).toBe(true)

    expect(await driver.read('GET /api/x')).toEqual(snapshot)
    expect(await driver.list()).toEqual(['GET /api/x'])

    await driver.remove('GET /api/x')
    expect(await driver.read('GET /api/x')).toBeNull()
  })

  it('validates on read for free — corrupt JSON throws', async () => {
    const driver = new MapJsonDriver()
    driver.store.set('GET /api/bad', '{ not json')
    await expect(driver.read('GET /api/bad')).rejects.toBeInstanceOf(SchemindValidationError)
  })

  it('validates on read for free — structurally invalid throws', async () => {
    const driver = new MapJsonDriver()
    driver.store.set('GET /api/bad', JSON.stringify({ endpoint: 'GET /api/bad' }))
    await expect(driver.read('GET /api/bad')).rejects.toBeInstanceOf(SchemindValidationError)
  })

  it('validates during list too', async () => {
    const driver = new MapJsonDriver()
    await driver.write(snapshot)
    driver.store.set('GET /api/corrupt', '{}')
    await expect(driver.list()).rejects.toBeInstanceOf(SchemindValidationError)
  })
})
