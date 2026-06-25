import { beforeEach, describe, expect, it, vi } from 'vitest'
import { otelReporter } from '../src/reporters/otel.js'
import { pagerDutyReporter } from '../src/reporters/pagerduty.js'
import { resetSecretWarnings } from '../src/reporters/secrets.js'
import { slackReporter } from '../src/reporters/slack.js'
import type { DriftReport } from '../src/types.js'

const breaking: DriftReport = {
  endpoint: 'GET /api/users',
  severity: 'breaking',
  changes: [{ path: 'name', type: 'field_removed', severity: 'breaking' }],
}
const info: DriftReport = {
  endpoint: 'GET /api/x',
  severity: 'info',
  changes: [{ path: 'b', type: 'field_added', severity: 'info' }],
}

describe('pagerDutyReporter', () => {
  it('triggers an incident for breaking and skips info', async () => {
    const bodies: Array<Record<string, unknown>> = []
    const fn = (async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)))
      return new Response('{}', { status: 202 })
    }) as typeof globalThis.fetch
    const r = pagerDutyReporter({ routingKey: process.env.PD_KEY ?? 'rk', fetch: fn })

    await r.report(info)
    expect(bodies).toHaveLength(0)
    await r.report(breaking)
    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toMatchObject({ event_action: 'trigger' })
    expect((bodies[0]!.payload as { severity: string }).severity).toBe('critical')
  })
})

describe('otelReporter', () => {
  it('emits a span with drift attributes', async () => {
    const attrs: Record<string, unknown> = {}
    let ended = false
    const tracer = {
      startSpan: () => ({
        setAttribute: (k: string, v: string | number | boolean) => {
          attrs[k] = v
        },
        end: () => {
          ended = true
        },
      }),
    }
    await otelReporter({ tracer }).report(breaking)
    expect(attrs['schemind.endpoint']).toBe('GET /api/users')
    expect(attrs['schemind.severity']).toBe('breaking')
    expect(attrs['schemind.change_count']).toBe(1)
    expect(ended).toBe(true)
  })
})

describe('secrets-in-config guard (#2)', () => {
  beforeEach(() => resetSecretWarnings())

  it('warns on a hardcoded secret but not an env-sourced one', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    slackReporter({ webhookUrl: 'https://hooks.slack.com/HARDCODED' })
    expect(warn).toHaveBeenCalledOnce()

    warn.mockClear()
    resetSecretWarnings()
    process.env.SCHEMIND_TEST_URL = 'https://hooks.slack.com/FROMENV'
    slackReporter({ webhookUrl: process.env.SCHEMIND_TEST_URL })
    expect(warn).not.toHaveBeenCalled()

    warn.mockRestore()
    delete process.env.SCHEMIND_TEST_URL
  })
})
