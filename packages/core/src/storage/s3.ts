import { endpointToFilename } from '../snapshot.js'
import { JsonStorageDriver, type RawRecord } from './base.js'

/**
 * A tiny object-store adapter schemind drives. Deliberately *not* the raw AWS
 * SDK (which is command-based) — wrap your `@aws-sdk/client-s3` client in these
 * four functions so schemind stays dependency-free:
 *
 * ```ts
 * import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'
 * const s3 = new S3Client({})
 * const Bucket = 'my-bucket'
 * const adapter: S3Like = {
 *   async getObject(key) {
 *     try { return await (await s3.send(new GetObjectCommand({ Bucket, Key: key }))).Body!.transformToString() }
 *     catch (e) { if ((e as { name?: string }).name === 'NoSuchKey') return null; throw e }
 *   },
 *   async putObject(key, body) { await s3.send(new PutObjectCommand({ Bucket, Key: key, Body: body })) },
 *   async deleteObject(key) { await s3.send(new DeleteObjectCommand({ Bucket, Key: key })) },
 *   async listKeys(prefix) {
 *     const out = await s3.send(new ListObjectsV2Command({ Bucket, Prefix: prefix }))
 *     return (out.Contents ?? []).map((o) => o.Key).filter((k): k is string => Boolean(k))
 *   },
 * }
 * ```
 */
export interface S3Like {
  /** Object body as text, or `null` if the key doesn't exist. */
  getObject(key: string): Promise<string | null>
  putObject(key: string, body: string): Promise<void>
  deleteObject(key: string): Promise<void>
  /** All keys under a prefix. */
  listKeys(prefix: string): Promise<string[]>
}

export interface S3StorageOptions {
  /** Key prefix for snapshot objects. Default `schemind/snapshots/`. */
  prefix?: string
}

/**
 * S3-backed snapshot driver — shared, durable team baselines for CI.
 *
 * Inherits JSON serialization + read-time validation from {@link JsonStorageDriver}.
 */
export class S3StorageDriver extends JsonStorageDriver {
  private readonly s3: S3Like
  private readonly prefix: string

  constructor(s3: S3Like, options: S3StorageOptions = {}) {
    super()
    this.s3 = s3
    const prefix = options.prefix ?? 'schemind/snapshots/'
    if (prefix.trim() === '') throw new Error('schemind: S3StorageDriver prefix must be non-empty')
    this.prefix = prefix
  }

  private keyFor(endpoint: string): string {
    return `${this.prefix}${endpointToFilename(endpoint)}.json`
  }

  protected readText(endpoint: string): Promise<string | null> {
    return this.s3.getObject(this.keyFor(endpoint))
  }

  protected writeText(endpoint: string, serialized: string): Promise<void> {
    return this.s3.putObject(this.keyFor(endpoint), serialized)
  }

  protected deleteText(endpoint: string): Promise<void> {
    return this.s3.deleteObject(this.keyFor(endpoint))
  }

  protected async readAllText(): Promise<RawRecord[]> {
    const keys = await this.s3.listKeys(this.prefix)
    const records: RawRecord[] = []
    for (const key of keys) {
      const text = await this.s3.getObject(key)
      if (text !== null) records.push({ id: key, text })
    }
    return records
  }
}
