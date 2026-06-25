/**
 * Turn a normalized endpoint key into a stable, unique PascalCase identifier.
 *
 * `GET /api/books/:id` → `GetApiBooksId`
 */
export function endpointToTypeName(endpoint: string): string {
  const trimmed = endpoint.trim()
  const space = trimmed.search(/\s/)
  const method = space === -1 ? trimmed : trimmed.slice(0, space)
  const rest = space === -1 ? '' : trimmed.slice(space + 1)
  const tokens = `${method} ${rest}`
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase())
  const name = tokens.join('')
  // Identifiers can't start with a digit.
  return /^[0-9]/.test(name) ? `_${name}` : name || 'Endpoint'
}

/**
 * Build a deduplicating name allocator — distinct endpoints that slug to the
 * same identifier get a numeric suffix (`Foo`, `Foo2`, …).
 */
export function nameAllocator(): (endpoint: string, suffix?: string) => string {
  const used = new Map<string, number>()
  return (endpoint, suffix = '') => {
    const base = `${endpointToTypeName(endpoint)}${suffix}`
    const seen = used.get(base) ?? 0
    used.set(base, seen + 1)
    return seen === 0 ? base : `${base}${seen + 1}`
  }
}

/** Is `key` a bare JS identifier (safe to use unquoted in an object type/literal)? */
export function isSafeKey(key: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
}
