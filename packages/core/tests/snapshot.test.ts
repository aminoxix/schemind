import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { extractShape } from '../src/extractor.js'
import { object, scalar } from '../src/shape.js'
import {
  type Clock,
  MemoryStorageDriver,
  type Snapshot,
  SnapshotStore,
  endpointToFilename,
} from '../src/snapshot.js'
import { LocalStorageDriver } from '../src/storage/local.js'
import { SchemindValidationError } from '../src/validate.js'

describe('endpointToFilename', () => {
  it('produces a readable slug with a disambiguating hash suffix', () => {
    expect(endpointToFilename('GET /api/users')).toMatch(/^GET__api_users__[0-9a-f]{8}$/)
    expect(endpointToFilename('GET /api/users/:id')).toMatch(/^GET__api_users__id__[0-9a-f]{8}$/)
    expect(endpointToFilename('POST /api/auth/login')).toMatch(
      /^POST__api_auth_login__[0-9a-f]{8}$/,
    )
  })

  it('is deterministic', () => {
    expect(endpointToFilename('GET /api/users')).toBe(endpointToFilename('GET /api/users'))
  })

  it('never collides for endpoints that share a lossy slug', () => {
    // Both slug to GET__api_a_b under the lossy [/:]→_ rule; the hash separates them.
    const a = endpointToFilename('GET /api/a:b')
    const b = endpointToFilename('GET /api/a/b')
    expect(a).not.toBe(b)
  })

  it('separates different hosts', () => {
    expect(endpointToFilename('GET http://a.com/api/x')).not.toBe(
      endpointToFilename('GET http://b.com/api/x'),
    )
  })
})

describe('SnapshotStore', () => {
  let dir: string
  let store: SnapshotStore
  let tick = 0
  const clock: Clock = () => `2026-01-01T00:00:0${tick}.000Z`

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'schemind-snap-'))
    tick = 0
    store = new SnapshotStore(new LocalStorageDriver(join(dir, 'snapshots')), () => {
      const t = clock()
      tick += 1
      return t
    })
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const shapeV1 = object({ id: scalar('number'), name: scalar('string') })
  const shapeV2 = object({ id: scalar('number'), name: scalar('string'), age: scalar('number') })

  it('creates version 1 on first commit', async () => {
    const res = await store.commit('GET /api/users/:id', shapeV1)
    expect(res.created).toBe(true)
    expect(res.changed).toBe(true)
    expect(res.snapshot.snapshotVersion).toBe(1)
    expect(res.snapshot.history).toEqual([])
  })

  it('is a no-op when the shape is unchanged', async () => {
    await store.commit('GET /api/users/:id', shapeV1)
    const res = await store.commit('GET /api/users/:id', shapeV1)
    expect(res.created).toBe(false)
    expect(res.changed).toBe(false)
    expect(res.snapshot.snapshotVersion).toBe(1)
  })

  it('bumps version and archives the prior shape on change', async () => {
    await store.commit('GET /api/users/:id', shapeV1)
    const res = await store.commit('GET /api/users/:id', shapeV2)
    expect(res.changed).toBe(true)
    expect(res.snapshot.snapshotVersion).toBe(2)
    expect(res.snapshot.history).toHaveLength(1)
    expect(res.snapshot.history[0]!.snapshotVersion).toBe(1)
    expect(res.snapshot.history[0]!.shape).toEqual(shapeV1)
    // createdAt preserved from v1; updatedAt advanced.
    expect(res.snapshot.createdAt).not.toBe(res.snapshot.updatedAt)
  })

  it('round-trips through the filesystem driver', async () => {
    await store.commit('GET /api/users/:id', shapeV1)
    const loaded = await store.load('GET /api/users/:id')
    expect(loaded?.shape).toEqual(shapeV1)
    expect(await store.list()).toEqual(['GET /api/users/:id'])
  })

  it('persists hash when provided', async () => {
    const res = await store.commit('GET /api/users/:id', shapeV1, { hash: 'a3f9b2c1' })
    expect(res.snapshot.hash).toBe('a3f9b2c1')
  })

  it('updates a hash in place without bumping version or history (shape unchanged)', async () => {
    await store.commit('GET /api/users/:id', shapeV1, { hash: 'h1' })
    const res = await store.commit('GET /api/users/:id', shapeV1, { hash: 'h2' })
    expect(res.changed).toBe(false)
    expect(res.snapshot.snapshotVersion).toBe(1)
    expect(res.snapshot.history).toEqual([])
    expect(res.snapshot.hash).toBe('h2')
  })

  it('clears the hash in place when re-committed without one', async () => {
    await store.commit('GET /api/users/:id', shapeV1, { hash: 'h1' })
    const res = await store.commit('GET /api/users/:id', shapeV1)
    expect(res.snapshot.snapshotVersion).toBe(1)
    expect(res.snapshot.hash).toBeUndefined()
  })

  it('removes a snapshot', async () => {
    await store.commit('GET /api/users/:id', shapeV1)
    await store.remove('GET /api/users/:id')
    expect(await store.load('GET /api/users/:id')).toBeNull()
    expect(await store.list()).toEqual([])
  })

  it('rejects a corrupt snapshot file (invalid JSON) at the read boundary', async () => {
    const snapDir = join(dir, 'snapshots')
    await mkdir(snapDir, { recursive: true })
    await writeFile(join(snapDir, `${endpointToFilename('GET /api/x')}.json`), '{ not json', 'utf8')
    await expect(store.load('GET /api/x')).rejects.toBeInstanceOf(SchemindValidationError)
  })

  it('rejects a structurally-invalid snapshot file at the read boundary', async () => {
    const snapDir = join(dir, 'snapshots')
    await mkdir(snapDir, { recursive: true })
    await writeFile(
      join(snapDir, `${endpointToFilename('GET /api/y')}.json`),
      JSON.stringify({ endpoint: 'GET /api/y', shape: { kind: 'bogus' } }),
      'utf8',
    )
    await expect(store.load('GET /api/y')).rejects.toBeInstanceOf(SchemindValidationError)
  })

  it('caps history at maxHistory, keeping the most recent', async () => {
    const fixed: Clock = () => '2026-01-01T00:00:00.000Z'
    const capped = new SnapshotStore(new LocalStorageDriver(join(dir, 'cap')), fixed, {
      maxHistory: 2,
    })
    for (let n = 1; n <= 4; n++) {
      const fields: Record<string, ReturnType<typeof scalar>> = {}
      for (let i = 0; i < n; i++) fields[`f${i}`] = scalar('number')
      await capped.commit('GET /api/h', object(fields))
    }
    const snap = await capped.load('GET /api/h')
    expect(snap?.snapshotVersion).toBe(4)
    expect(snap?.history).toHaveLength(2)
    expect(snap?.history.map((h) => h.snapshotVersion)).toEqual([2, 3])
  })

  it('keeps full history under "unlimited" but is hard-capped on writes (sec #2)', async () => {
    const fixed: Clock = () => '2026-01-01T00:00:00.000Z'
    // maxHistory: 0 = "unlimited" — but commit still hard-caps at the validator ceiling.
    const s = new SnapshotStore(new LocalStorageDriver(join(dir, 'hardcap')), fixed, {
      maxHistory: 0,
    })
    for (let n = 1; n <= 5; n++) {
      const fields: Record<string, ReturnType<typeof scalar>> = {}
      for (let i = 0; i < n; i++) fields[`f${i}`] = scalar('number')
      await s.commit('GET /api/h', object(fields))
    }
    const snap = await s.load('GET /api/h')
    expect(snap?.history).toHaveLength(4) // all 4 prior versions retained (well under the 10k ceiling)
  })

  it('records acceptance metadata and archives it into history (F8)', async () => {
    const fixed: Clock = () => '2026-02-02T00:00:00.000Z'
    const s = new SnapshotStore(new LocalStorageDriver(join(dir, 'acc')), fixed)
    await s.commit('GET /api/a', object({ x: scalar('number') }))
    const r = await s.commit('GET /api/a', object({ x: scalar('string') }), {
      acceptance: { acceptedBy: 'aminos', reason: 'intended retype' },
    })
    expect(r.snapshot.acceptance).toEqual({
      acceptedBy: 'aminos',
      acceptedAt: '2026-02-02T00:00:00.000Z',
      reason: 'intended retype',
    })

    const r2 = await s.commit('GET /api/a', object({ x: scalar('boolean') }), {
      acceptance: { acceptedBy: 'bob' },
    })
    const archived = r2.snapshot.history.find((h) => h.snapshotVersion === 2)
    expect(archived?.acceptance?.acceptedBy).toBe('aminos')
    expect(r2.snapshot.acceptance?.acceptedBy).toBe('bob')
  })

  it('stores only shapes, never values', async () => {
    await store.commit('GET /api/me', extractShape({ id: 1, secret: 'token-xyz' }))
    const loaded = await store.load('GET /api/me')
    expect(JSON.stringify(loaded)).not.toContain('token-xyz')
  })
})

describe('MemoryStorageDriver LRU', () => {
  const snap = (endpoint: string): Snapshot => ({
    endpoint,
    snapshotVersion: 1,
    createdAt: 't',
    updatedAt: 't',
    shape: scalar('number'),
    history: [],
  })

  it('evicts the least-recently-used entry beyond maxEntries', async () => {
    const driver = new MemoryStorageDriver({ maxEntries: 2 })
    await driver.write(snap('a'))
    await driver.write(snap('b'))
    await driver.read('a') // touch 'a' → 'b' is now least-recently-used
    await driver.write(snap('c')) // exceeds cap → evicts 'b'

    expect(await driver.read('a')).not.toBeNull()
    expect(await driver.read('b')).toBeNull()
    expect(await driver.read('c')).not.toBeNull()
    expect((await driver.list()).length).toBe(2)
  })
})
