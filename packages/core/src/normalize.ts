/**
 * Endpoint normalization.
 *
 * Turns a concrete request into a stable, parameterized endpoint key so that
 * `/api/users/123` and `/api/users/456` collapse to a single
 * `GET /api/users/:id` — otherwise every distinct id would get its own
 * snapshot.
 */

/** A path-rewriting rule applied during normalization. */
export interface ParamPattern {
  /** Must carry the global flag so every occurrence is rewritten. */
  pattern: RegExp
  /** Replacement, e.g. `/:id`. */
  replacement: string
}

const UUID =
  /\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}(?=\/|$)/g

const NUMERIC = /\/\d+(?=\/|$)/g

/**
 * Default rules: UUID segments and purely-numeric segments both collapse to
 * `/:id`. Override via {@link SchemindOptions.paramPatterns} for hashes, slugs,
 * etc.
 */
export const DEFAULT_PARAM_PATTERNS: readonly ParamPattern[] = [
  { pattern: UUID, replacement: '/:id' },
  { pattern: NUMERIC, replacement: '/:id' },
]

/** Extract the pathname from an absolute or relative URL, dropping query/hash. */
export function pathOf(url: string): string {
  // Absolute URL → parse with a base to be safe; relative → strip manually.
  try {
    const parsed = new URL(url, 'http://schemind.local')
    return parsed.pathname
  } catch {
    const noHash = url.split('#', 1)[0] ?? url
    const noQuery = noHash.split('?', 1)[0] ?? noHash
    return noQuery.startsWith('/') ? noQuery : `/${noQuery}`
  }
}

/**
 * Extract the origin (`scheme://host:port`) of an **absolute** URL, or `''` for
 * a relative one. Used to keep endpoints from different hosts in separate
 * snapshots — `api-a.com/api/users` and `api-b.com/api/users` must not collide.
 */
export function originOf(url: string): string {
  try {
    // No base → throws for relative URLs, which correctly yields no origin.
    return new URL(url).origin
  } catch {
    return ''
  }
}

/** Options for {@link normalizeEndpoint}. */
export interface NormalizeOptions {
  /** Param-normalization rules. Defaults to {@link DEFAULT_PARAM_PATTERNS}. */
  patterns?: readonly ParamPattern[]
  /**
   * Prefix the key with the request origin for absolute URLs so different hosts
   * don't share a snapshot. Default `true`. Set `false` when several hosts proxy
   * one logical API and should be merged. Relative URLs never carry an origin.
   */
  includeOrigin?: boolean
}

/** Apply param patterns to a pathname. */
export function normalizePath(
  path: string,
  patterns: readonly ParamPattern[] = DEFAULT_PARAM_PATTERNS,
): string {
  let out = path
  for (const { pattern, replacement } of patterns) {
    // Reset lastIndex defensively in case a shared stateful regex is passed in.
    pattern.lastIndex = 0
    out = out.replace(pattern, replacement)
  }
  // Collapse any accidental trailing slash (but keep root "/").
  return out.length > 1 && out.endsWith('/') ? out.slice(0, -1) : out
}

/**
 * Build a normalized endpoint key.
 *
 * - relative URL → `GET /api/users/:id`
 * - absolute URL → `GET http://api.example.com/api/users/:id` (origin included by default)
 *
 * @param method HTTP method (case-insensitive in, upper-cased out)
 * @param url    absolute or relative request URL
 */
export function normalizeEndpoint(
  method: string,
  url: string,
  options: NormalizeOptions = {},
): string {
  const patterns = options.patterns ?? DEFAULT_PARAM_PATTERNS
  const origin = (options.includeOrigin ?? true) ? originOf(url) : ''
  return `${method.toUpperCase()} ${origin}${normalizePath(pathOf(url), patterns)}`
}
