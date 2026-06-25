import { describe, expect, it } from 'vitest'
import { object, scalar } from '../src/shape.js'
import {
  type Clock,
  SnapshotStore,
  type StorageDriver,
  endpointToFilename,
} from '../src/snapshot.js'
import { type RedisLike, RedisStorageDriver } from '../src/storage/redis.js'
import { type S3Like, S3StorageDriver } from '../src/storage/s3.js'
import { SchemindValidationError } from '../src/validate.js'

/* ------------------------------- fakes ----------------------------------- */

/** In-memory stand-in for ioredis / node-redis. */
class FakeRedis implements RedisLike {
  readonly store = new Map<string, string>()
  get(key: string): Promise<string | null> {
    return Promise.resolve(this.store.get(key) ?? null)
  }
  set(key: string, value: string): Promise<unknown> {
    this.store.set(key, value)
    return Promise.resolve('OK')
  }
  del(key: string): Promise<unknown> {
    return Promise.resolve(this.store.delete(key) ? 1 : 0)
  }
  keys(pattern: string): Promise<string[]> {
    const prefix = pattern.endsWith('*') ? pattern.slice(0, -1) : pattern
    return Promise.resolve([...this.store.keys()].filter((k) => k.startsWith(prefix)))
  }
}

/** In-memory stand-in for an S3 adapter. */
class FakeS3 implements S3Like {
  readonly store = new Map<string, string>()
  getObject(key: string): Promise<string | null> {
    return Promise.resolve(this.store.get(key) ?? null)
  }
  putObject(key: string, body: string): Promise<void> {
    this.store.set(key, body)
    return Promise.resolve()
  }
  deleteObject(key: string): Promise<void> {
    this.store.delete(key)
    return Promise.resolve()
  }
  listKeys(prefix: string): Promise<string[]> {
    return Promise.resolve([...this.store.keys()].filter((k) => k.startsWith(prefix)))
  }
}

/* ------------------------------- shared suite ---------------------------- */

const clock: Clock = (() => {
  let n = 0
  return () => `2026-01-01T00:00:0${n++}.000Z`
})()

const shapeV1 = object({ id: scalar('number') })
const shapeV2 = object({ id: scalar('number'), title: scalar('string') })

interface Case {
  name: string
  make: () => {
    driver: StorageDriver
    inject: (endpoint: string, raw: string) => void
  }
}

const cases: Case[] = [
  {
    name: 'RedisStorageDriver',
    make: () => {
      const redis = new FakeRedis()
      return {
        driver: new RedisStorageDriver(redis),
        inject: (endpoint, raw) =>
          redis.store.set(`schemind:snapshot:${endpointToFilename(endpoint)}`, raw),
      }
    },
  },
  {
    name: 'S3StorageDriver',
    make: () => {
      const s3 = new FakeS3()
      return {
        driver: new S3StorageDriver(s3),
        inject: (endpoint, raw) =>
          s3.store.set(`schemind/snapshots/${endpointToFilename(endpoint)}.json`, raw),
      }
    },
  },
]

describe('driver guards (#5 empty-prefix collision)', () => {
  it('rejects an empty or whitespace prefix', () => {
    expect(() => new RedisStorageDriver(new FakeRedis(), { prefix: '' })).toThrow(/non-empty/)
    expect(() => new S3StorageDriver(new FakeS3(), { prefix: '   ' })).toThrow(/non-empty/)
  })
})

describe.each(cases)('$name', ({ make }) => {
  it('round-trips create → no-op → version bump via SnapshotStore', async () => {
    const { driver } = make()
    const store = new SnapshotStore(driver, clock)

    const created = await store.commit('GET /api/books', shapeV1)
    expect(created.created).toBe(true)
    expect(created.snapshot.snapshotVersion).toBe(1)

    const noop = await store.commit('GET /api/books', shapeV1)
    expect(noop.changed).toBe(false)
    expect(noop.snapshot.snapshotVersion).toBe(1)

    const bumped = await store.commit('GET /api/books', shapeV2)
    expect(bumped.changed).toBe(true)
    expect(bumped.snapshot.snapshotVersion).toBe(2)
    expect(bumped.snapshot.history).toHaveLength(1)

    expect((await store.load('GET /api/books'))?.shape).toEqual(shapeV2)
    expect(await store.list()).toEqual(['GET /api/books'])

    await store.remove('GET /api/books')
    expect(await store.load('GET /api/books')).toBeNull()
  })

  it('keeps distinct endpoints separate', async () => {
    const { driver } = make()
    const store = new SnapshotStore(driver, clock)
    await store.commit('GET /api/books', shapeV1)
    await store.commit('GET /api/authors', shapeV2)
    expect((await store.list()).sort()).toEqual(['GET /api/authors', 'GET /api/books'])
  })

  it('inherits read-time validation (corrupt JSON throws)', async () => {
    const { driver, inject } = make()
    inject('GET /api/bad', '{ not json')
    await expect(driver.read('GET /api/bad')).rejects.toBeInstanceOf(SchemindValidationError)
  })

  it('inherits read-time validation (malformed structure throws)', async () => {
    const { driver, inject } = make()
    inject('GET /api/bad', JSON.stringify({ endpoint: 'GET /api/bad', shape: { kind: 'nope' } }))
    await expect(driver.read('GET /api/bad')).rejects.toBeInstanceOf(SchemindValidationError)
  })
})
