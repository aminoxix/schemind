import { describe, expect, it } from 'vitest'
import { endpointHealth, rankEndpointHealth, staleEndpoints } from '../src/health.js'
import { scalar } from '../src/shape.js'
import type { Snapshot } from '../src/snapshot.js'

function snap(endpoint: string, version: number, createdAt: string): Snapshot {
  return {
    endpoint,
    snapshotVersion: version,
    createdAt,
    updatedAt: createdAt,
    shape: scalar('number'),
    history: [],
  }
}

const NOW = Date.parse('2026-01-08T00:00:00.000Z') // 7 days after Jan 1

describe('endpointHealth (F9)', () => {
  it('scores a never-changed endpoint 100', () => {
    const h = endpointHealth(snap('GET /a', 1, '2026-01-01T00:00:00.000Z'), NOW)
    expect(h.changes).toBe(0)
    expect(h.score).toBe(100)
    expect(h.ageDays).toBe(7)
  })

  it('drives the score down with frequent changes', () => {
    // 7 changes over 7 days → ~7 changes/week → score 100/8 ≈ 13
    const h = endpointHealth(snap('GET /b', 8, '2026-01-01T00:00:00.000Z'), NOW)
    expect(h.changes).toBe(7)
    expect(h.changesPerWeek).toBe(7)
    expect(h.score).toBe(13)
  })

  it('surfaces the last acceptance', () => {
    const s = snap('GET /c', 2, '2026-01-01T00:00:00.000Z')
    s.acceptance = { acceptedBy: 'aminos', acceptedAt: '2026-01-05T00:00:00.000Z' }
    expect(endpointHealth(s, NOW).lastAcceptance?.acceptedBy).toBe('aminos')
  })
})

describe('rankEndpointHealth', () => {
  it('orders least-stable first', () => {
    const ranked = rankEndpointHealth(
      [
        snap('GET /stable', 1, '2026-01-01T00:00:00.000Z'),
        snap('GET /flaky', 8, '2026-01-01T00:00:00.000Z'),
      ],
      NOW,
    )
    expect(ranked.map((h) => h.endpoint)).toEqual(['GET /flaky', 'GET /stable'])
  })
})

describe('staleEndpoints (gc)', () => {
  it('flags baselines older than the window, oldest first', () => {
    const snaps = [
      snap('GET /fresh', 1, '2026-01-07T00:00:00.000Z'), // 1 day old
      snap('GET /old', 1, '2026-01-01T00:00:00.000Z'), // 7 days old
    ]
    const stale = staleEndpoints(snaps, 3 * 86_400_000, NOW) // older than 3 days
    expect(stale.map((s) => s.endpoint)).toEqual(['GET /old'])
    expect(stale[0]?.ageDays).toBe(7)
  })
})
