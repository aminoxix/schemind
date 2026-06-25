import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { githubReporter } from '../src/reporters/github.js'
import { jsonReporter } from '../src/reporters/json.js'
import { driftToMarkdown } from '../src/reporters/markdown.js'
import { slackReporter } from '../src/reporters/slack.js'
import { webhookReporter } from '../src/reporters/webhook.js'
import { scalar } from '../src/shape.js'
import type { DriftReport } from '../src/types.js'

const breaking: DriftReport = {
  endpoint: 'GET /api/users',
  severity: 'breaking',
  changes: [{ path: 'name', type: 'field_removed', severity: 'breaking', from: scalar('string') }],
}
const info: DriftReport = {
  endpoint: 'GET /api/x',
  severity: 'info',
  changes: [{ path: 'b', type: 'field_added', severity: 'info', to: scalar('number') }],
}

interface Call {
  url: string
  method: string
  body: unknown
}

function fakeFetch(handler?: (url: string, method: string) => Response) {
  const calls: Call[] = []
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url)
    const method = init?.method ?? 'GET'
    calls.push({ url: u, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    return handler?.(u, method) ?? new Response('{}', { status: 200 })
  }) as typeof globalThis.fetch
  return { fn, calls }
}

describe('jsonReporter', () => {
  it('emits the report as a JSON line', async () => {
    const lines: string[] = []
    await jsonReporter({ sink: (l) => lines.push(l) }).report(breaking)
    expect(JSON.parse(lines[0]!)).toMatchObject({
      endpoint: 'GET /api/users',
      severity: 'breaking',
    })
  })
})

describe('webhookReporter', () => {
  it('POSTs the report JSON', async () => {
    const { fn, calls } = fakeFetch()
    await webhookReporter({ url: 'https://hook.test/x', fetch: fn }).report(breaking)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ url: 'https://hook.test/x', method: 'POST' })
    expect(calls[0]!.body).toMatchObject({ endpoint: 'GET /api/users' })
  })

  it('respects notifyOn', async () => {
    const { fn, calls } = fakeFetch()
    await webhookReporter({ url: 'https://hook.test/x', fetch: fn, notifyOn: ['breaking'] }).report(
      info,
    )
    expect(calls).toHaveLength(0)
  })

  it('HMAC-signs the payload when a secret is set (#3)', async () => {
    let captured: { headers: Record<string, string>; body: string } | null = null
    const fn = (async (_url: unknown, init?: RequestInit) => {
      captured = { headers: init?.headers as Record<string, string>, body: String(init?.body) }
      return new Response('{}', { status: 200 })
    }) as typeof globalThis.fetch

    await webhookReporter({ url: 'https://hook.test/x', secret: 'topsecret', fetch: fn }).report(
      breaking,
    )

    const sig = captured!.headers['X-Schemind-Signature']
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/)
    // Web Crypto HMAC must match node:crypto's HMAC of the same body.
    const expected = createHmac('sha256', 'topsecret').update(captured!.body).digest('hex')
    expect(sig).toBe(`sha256=${expected}`)
  })
})

describe('slackReporter', () => {
  it('posts Block Kit and skips info by default', async () => {
    const { fn, calls } = fakeFetch()
    const reporter = slackReporter({ webhookUrl: 'https://slack.test/hook', fetch: fn })
    await reporter.report(info) // info not in default notifyOn → skipped
    expect(calls).toHaveLength(0)
    await reporter.report(breaking)
    expect(calls).toHaveLength(1)
    const body = calls[0]!.body as { blocks: unknown[]; text: string }
    expect(body.text).toContain('GET /api/users')
    expect(body.blocks.length).toBeGreaterThan(0)
  })
})

describe('githubReporter', () => {
  it('creates then updates a single PR comment (upsert)', async () => {
    const { fn, calls } = fakeFetch((_url, method) => {
      if (method === 'GET') return new Response('[]', { status: 200 }) // no existing comment
      if (method === 'POST') return new Response(JSON.stringify({ id: 99 }), { status: 201 })
      return new Response('{}', { status: 200 }) // PATCH
    })
    const reporter = githubReporter({ token: 't', repo: 'me/app', pullNumber: 7, fetch: fn })

    await reporter.report(breaking)
    expect(calls.map((c) => c.method)).toEqual(['GET', 'POST']) // locate, then create
    expect(calls[1]!.url).toContain('/repos/me/app/issues/7/comments')

    await reporter.report(info)
    // second report reuses the cached comment id → PATCH, no second GET
    expect(calls.map((c) => c.method)).toEqual(['GET', 'POST', 'PATCH'])
    expect(calls[2]!.url).toContain('/issues/comments/99')
  })
})

describe('driftToMarkdown', () => {
  it('builds an aggregated table with a summary', () => {
    const md = driftToMarkdown([breaking, info])
    expect(md).toContain('## schemind')
    expect(md).toContain('GET /api/users')
    expect(md).toContain('| path | change | severity | shape |')
    expect(md).toContain('field_removed')
  })

  it('reports clean when there is no drift', () => {
    expect(driftToMarkdown([])).toContain('no API shape drift')
  })
})
