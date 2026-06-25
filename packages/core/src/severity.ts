import type { ChangeType, Severity } from './types.js'

/**
 * The canonical mapping from {@link ChangeType} to {@link Severity}.
 *
 * ⚠️ These rules are a product decision (see SKILL.md — "Severity rules").
 * Do not change them without team discussion.
 */
export const SEVERITY_BY_CHANGE_TYPE: Readonly<Record<ChangeType, Severity>> = {
  field_added: 'info',
  field_removed: 'breaking',
  type_changed: 'breaking',
  became_nullable: 'warn',
  became_required: 'warn',
  array_item_changed: 'breaking',
}

/** Severity ordering, ascending in urgency. */
export const SEVERITY_RANK: Readonly<Record<Severity, number>> = {
  info: 0,
  warn: 1,
  breaking: 2,
}

/** Severity for a given change type. */
export function severityOf(type: ChangeType): Severity {
  return SEVERITY_BY_CHANGE_TYPE[type]
}

/** Return the more urgent of two severities. */
export function maxSeverity(a: Severity, b: Severity): Severity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b
}

/**
 * Reduce a list of severities to the single highest. Returns `'info'` for an
 * empty list — an observation with no changes is informational, not breaking.
 */
export function highestSeverity(severities: readonly Severity[]): Severity {
  return severities.reduce<Severity>((acc, s) => maxSeverity(acc, s), 'info')
}
