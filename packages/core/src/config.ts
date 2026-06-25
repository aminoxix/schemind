import type { ParamPattern } from './normalize.js'
import type { ScanRoute } from './scan.js'
import type { StorageDriver } from './snapshot.js'
import type { Reporter, Severity } from './types.js'

/**
 * schemind project configuration, normally exported from `schemind.config.mjs`
 * (or `.js` / `.json`) at the project root and consumed by the `schm` CLI.
 */
export interface SchemindConfig {
  /** Default target for `schm scan` / `schm ci`. */
  baseUrl?: string
  /** Routes to probe — inline, or a path to a JSON file. */
  routes?: ScanRoute[] | string
  /**
   * Where baselines live. Pass a ready {@link StorageDriver} instance (this is
   * how you wire Redis/S3 — construct the client in your config), or a shorthand
   * for the built-in file/in-memory stores.
   */
  storage?: StorageDriver | { driver: 'local' | 'memory'; path?: string }
  /** Active reporters. Defaults to the console reporter in the CLI. */
  reporters?: Reporter[]
  /** Endpoint param-normalization overrides. */
  paramPatterns?: ParamPattern[]
  /** Object keys to drop from shapes at any depth (e.g. `updatedAt`, `requestId`) to avoid noise. */
  ignoreFields?: string[]
  /** Drop fields by path pattern, e.g. `data[].updatedAt`, `*.requestId`, `**.timestamp`. */
  ignorePaths?: string[]
  /** Trust the backend adapter's `X-Schemind-Schema-Hash` fast-path. Default `false`. */
  trustAdapterHash?: boolean
  /** SSRF hardening: reject loopback/private/link-local scan targets. Default `false`. */
  blockPrivateNetworks?: boolean
  /** Body-size cap (bytes) for scan/ci/replay. Default `1_000_000`. */
  maxBodyBytes?: number
  /** Include the request origin in endpoint keys. Default `true` (CLI scans force `false`). */
  includeOrigin?: boolean
  /** CI behavior. */
  ci?: {
    /** Minimum severity that makes `schm ci` exit non-zero. Default `breaking`. */
    failOn?: Severity
  }
  /** Master switch — set `false` to disable schemind entirely (e.g. in production). */
  enabled?: boolean
}

/**
 * Identity helper that gives full type-checking + autocomplete to a config file:
 *
 * ```ts
 * import { defineConfig } from 'schemind'
 * export default defineConfig({ baseUrl: 'http://localhost:8080', routes: './routes.json' })
 * ```
 */
export function defineConfig(config: SchemindConfig): SchemindConfig {
  return config
}
