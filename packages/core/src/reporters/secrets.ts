const warned = new Set<string>()

/**
 * Warn (once per label) when a secret looks **hardcoded** in config rather than
 * sourced from the environment. `schemind.config.mjs` is usually committed, so a
 * literal Slack URL / GitHub token would leak into git. Heuristic: if the value
 * doesn't match any `process.env.*`, it was probably written inline.
 *
 * No-op in the browser (no `process`), where the concern doesn't apply.
 */
export function warnIfHardcodedSecret(value: string | undefined, label: string): void {
  if (!value || typeof process === 'undefined' || !process.env) return
  const fromEnv = Object.values(process.env).includes(value)
  if (!fromEnv && !warned.has(label)) {
    warned.add(label)
    console.warn(
      `[schemind] ${label} looks hardcoded — read it from process.env (e.g. process.env.SCHEMIND_*) so it isn't committed to git.`,
    )
  }
}

/** Test hook: reset the one-time-warning memory. */
export function resetSecretWarnings(): void {
  warned.clear()
}
