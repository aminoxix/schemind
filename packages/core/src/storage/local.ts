import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { endpointToFilename } from '../snapshot.js'
import { JsonStorageDriver, type RawRecord } from './base.js'

/**
 * Filesystem-backed snapshot driver. Default location: `.schemind/snapshots`.
 *
 * Inherits JSON serialization + read-time validation from {@link JsonStorageDriver};
 * only the raw file I/O lives here. Behind the `schemind/node` entry point so the
 * browser-facing `.` entry stays free of `node:fs`.
 */
export class LocalStorageDriver extends JsonStorageDriver {
  private readonly dir: string

  constructor(dir = join('.schemind', 'snapshots')) {
    super()
    this.dir = dir
  }

  private fileFor(endpoint: string): string {
    return join(this.dir, `${endpointToFilename(endpoint)}.json`)
  }

  protected async readText(endpoint: string): Promise<string | null> {
    try {
      return await readFile(this.fileFor(endpoint), 'utf8')
    } catch (err) {
      if (isNotFound(err)) return null
      throw err
    }
  }

  protected async writeText(endpoint: string, serialized: string): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    await writeFile(this.fileFor(endpoint), serialized, 'utf8')
  }

  protected async deleteText(endpoint: string): Promise<void> {
    await rm(this.fileFor(endpoint), { force: true })
  }

  protected async readAllText(): Promise<RawRecord[]> {
    let entries: string[]
    try {
      entries = await readdir(this.dir)
    } catch (err) {
      if (isNotFound(err)) return []
      throw err
    }
    const records: RawRecord[] = []
    for (const name of entries) {
      if (!name.endsWith('.json')) continue
      const file = join(this.dir, name)
      records.push({ id: file, text: await readFile(file, 'utf8') })
    }
    return records
  }
}

function isNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === 'ENOENT'
  )
}
