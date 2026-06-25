import type { Snapshot, StorageDriver } from '../snapshot.js'
import { SchemindValidationError, parseSnapshot } from '../validate.js'

/** A stored serialized record plus a label used only for error messages. */
export interface RawRecord {
  /** Identifier for diagnostics (filename, key, …). */
  id: string
  /** The serialized snapshot JSON. */
  text: string
}

/**
 * Base class for JSON-serializing snapshot drivers.
 *
 * A subclass implements only raw **text** persistence (`readText` / `writeText`
 * / `deleteText` / `readAllText`); this base owns the two things every driver
 * must get right and shouldn't have to re-implement:
 *
 * 1. **Serialization** — canonical `JSON.stringify` on write.
 * 2. **Validation** — every value read back from the (untrusted) store is run
 *    through {@link parseSnapshot}, so a corrupt or hand-edited record fails
 *    fast with a {@link SchemindValidationError} instead of poisoning the diff
 *    engine.
 *
 * Browser-safe (no Node built-ins), so localStorage/IndexedDB/S3/Redis drivers
 * all inherit the same guarantees. {@link LocalStorageDriver} extends this.
 */
export abstract class JsonStorageDriver implements StorageDriver {
  /** Read the serialized snapshot for an endpoint, or `null` if absent. */
  protected abstract readText(endpoint: string): Promise<string | null>
  /** Persist the serialized snapshot for an endpoint. */
  protected abstract writeText(endpoint: string, serialized: string): Promise<void>
  /** Remove the snapshot for an endpoint if present. */
  protected abstract deleteText(endpoint: string): Promise<void>
  /** Return every stored serialized snapshot (used to enumerate endpoints). */
  protected abstract readAllText(): Promise<Iterable<RawRecord>>

  async read(endpoint: string): Promise<Snapshot | null> {
    const text = await this.readText(endpoint)
    return text === null ? null : parseSnapshot(parseJson(text, endpoint), endpoint)
  }

  async write(snapshot: Snapshot): Promise<void> {
    await this.writeText(snapshot.endpoint, serialize(snapshot))
  }

  remove(endpoint: string): Promise<void> {
    return this.deleteText(endpoint)
  }

  async list(): Promise<string[]> {
    const endpoints: string[] = []
    for (const { id, text } of await this.readAllText()) {
      endpoints.push(parseSnapshot(parseJson(text, id), id).endpoint)
    }
    return endpoints
  }
}

/** Canonical on-the-wire form: pretty-printed JSON with a trailing newline. */
export function serialize(snapshot: Snapshot): string {
  return `${JSON.stringify(snapshot, null, 2)}\n`
}

function parseJson(text: string, source: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    throw new SchemindValidationError(`Corrupt snapshot JSON (${source})`)
  }
}
