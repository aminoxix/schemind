import type { DriftReport, Reporter, Severity } from '../types.js'
import { warnIfHardcodedSecret } from './secrets.js'

type FetchFn = typeof globalThis.fetch

const ENDPOINT = 'https://events.pagerduty.com/v2/enqueue'
const PD_SEVERITY: Record<Severity, string> = {
  breaking: 'critical',
  warn: 'warning',
  info: 'info',
}

/** Configuration for {@link pagerDutyReporter}. */
export interface PagerDutyReporterOptions {
  /** PagerDuty Events API v2 integration (routing) key. */
  routingKey: string
  /** Severities that trigger an incident. Default: `['breaking']`. */
  notifyOn?: readonly Severity[]
  /** Events API URL (override for EU service region). */
  apiUrl?: string
  /** Fetch implementation. Defaults to `globalThis.fetch`. */
  fetch?: FetchFn
}

/**
 * Triggers a PagerDuty incident (Events API v2) for drift — for on-call
 * escalation of breaking changes, distinct from async Slack notification.
 */
export function pagerDutyReporter(options: PagerDutyReporterOptions): Reporter {
  warnIfHardcodedSecret(options.routingKey, 'pagerduty routingKey')
  const notifyOn = options.notifyOn ?? (['breaking'] as const)
  return {
    name: 'pagerduty',
    async report(drift: DriftReport): Promise<void> {
      if (!notifyOn.includes(drift.severity)) return
      const doFetch = options.fetch ?? globalThis.fetch
      await doFetch(options.apiUrl ?? ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          routing_key: options.routingKey,
          event_action: 'trigger',
          dedup_key: `schemind:${drift.endpoint}`,
          payload: {
            summary: `schemind: ${drift.severity} API shape drift on ${drift.endpoint}`,
            source: drift.endpoint,
            severity: PD_SEVERITY[drift.severity],
            custom_details: {
              changes: drift.changes.map((c) => `${c.path || '(root)'}: ${c.type}`),
            },
          },
        }),
      })
    },
  }
}
