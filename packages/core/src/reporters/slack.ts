import type { DriftReport, Reporter, Severity } from '../types.js'
import { describeShape } from './format.js'
import { warnIfHardcodedSecret } from './secrets.js'

type FetchFn = typeof globalThis.fetch

const EMOJI: Record<Severity, string> = { info: '🔵', warn: '🟡', breaking: '🔴' }

/** Configuration for {@link slackReporter}. */
export interface SlackReporterOptions {
  /** Slack incoming-webhook URL. */
  webhookUrl: string
  /** Only notify for these severities. Default: `['warn', 'breaking']`. */
  notifyOn?: readonly Severity[]
  /** Fetch implementation. Defaults to `globalThis.fetch`. */
  fetch?: FetchFn
}

/** Posts a Slack Block Kit message per drift report to an incoming webhook. */
export function slackReporter(options: SlackReporterOptions): Reporter {
  warnIfHardcodedSecret(options.webhookUrl, 'slack webhookUrl')
  const notifyOn = options.notifyOn ?? (['warn', 'breaking'] as const)
  return {
    name: 'slack',
    async report(drift: DriftReport): Promise<void> {
      if (!notifyOn.includes(drift.severity)) return
      const doFetch = options.fetch ?? globalThis.fetch
      await doFetch(options.webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildMessage(drift)),
      })
    },
  }
}

function buildMessage(drift: DriftReport): unknown {
  const changeLines = drift.changes
    .map(
      (c) => `${EMOJI[c.severity]} \`${c.path || '(root)'}\` — ${c.type}${shapeHint(c.from, c.to)}`,
    )
    .join('\n')
  return {
    text: `${EMOJI[drift.severity]} schemind: ${drift.severity} drift on ${drift.endpoint}`,
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `${EMOJI[drift.severity]} API shape drift — ${drift.severity}`,
        },
      },
      { type: 'section', text: { type: 'mrkdwn', text: `*${drift.endpoint}*` } },
      { type: 'section', text: { type: 'mrkdwn', text: changeLines || '_no changes_' } },
    ],
  }
}

function shapeHint(
  from: DriftReport['changes'][number]['from'],
  to: DriftReport['changes'][number]['to'],
): string {
  if (from && to) return ` (${describeShape(from)} → ${describeShape(to)})`
  if (to) return ` (+ ${describeShape(to)})`
  if (from) return ` (− ${describeShape(from)})`
  return ''
}
