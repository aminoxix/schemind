import { endpointToFilename } from '../snapshot.js'
import { JsonStorageDriver, type RawRecord } from './base.js'

/**
 * The minimal slice of a Redis client schemind needs. Both
 * [`ioredis`](https://github.com/redis/ioredis) and
 * [`node-redis` v4](https://github.com/redis/node-redis) satisfy it out of the box,
 * so schemind never depends on a Redis library itself — you bring your own client.
 */
export interface RedisLike {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<unknown>
  del(key: string): Promise<unknown>
  /** Glob match (e.g. `schemind:snapshot:*`). */
  keys(pattern: string): Promise<string[]>
}

export interface RedisStorageOptions {
  /** Key prefix for snapshot entries. Default `schemind:snapshot:`. */
  prefix?: string
}

/**
 * Redis-backed snapshot driver — a shared, fast baseline for high-frequency
 * proxy deployments and multi-instance setups (no per-process drift).
 *
 * Inherits JSON serialization + read-time validation from {@link JsonStorageDriver}.
 *
 * ```ts
 * import Redis from 'ioredis'
 * import { RedisStorageDriver } from 'schemind/node'
 * import { SnapshotStore } from 'schemind'
 *
 * const store = new SnapshotStore(new RedisStorageDriver(new Redis()))
 * ```
 */
export class RedisStorageDriver extends JsonStorageDriver {
  private readonly client: RedisLike
  private readonly prefix: string

  constructor(client: RedisLike, options: RedisStorageOptions = {}) {
    super()
    this.client = client
    const prefix = options.prefix ?? 'schemind:snapshot:'
    // An empty prefix would let snapshot keys collide with unrelated keys in a
    // shared Redis instance.
    if (prefix.trim() === '')
      throw new Error('schemind: RedisStorageDriver prefix must be non-empty')
    this.prefix = prefix
  }

  // Hash-suffixed slug → collision-free and free of Redis glob metacharacters.
  private keyFor(endpoint: string): string {
    return this.prefix + endpointToFilename(endpoint)
  }

  protected readText(endpoint: string): Promise<string | null> {
    return this.client.get(this.keyFor(endpoint))
  }

  protected async writeText(endpoint: string, serialized: string): Promise<void> {
    await this.client.set(this.keyFor(endpoint), serialized)
  }

  protected async deleteText(endpoint: string): Promise<void> {
    await this.client.del(this.keyFor(endpoint))
  }

  protected async readAllText(): Promise<RawRecord[]> {
    const keys = await this.client.keys(`${this.prefix}*`)
    const records: RawRecord[] = []
    for (const key of keys) {
      const text = await this.client.get(key)
      if (text !== null) records.push({ id: key, text })
    }
    return records
  }
}
