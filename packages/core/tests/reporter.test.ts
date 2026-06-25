import { describe, expect, it, vi } from 'vitest'
import { diffReport } from '../src/diff.js'
import { runReporters } from '../src/pipeline.js'
import { consoleReporter } from '../src/reporters/console.js'
import { describeShape, formatReport } from '../src/reporters/format.js'
import { array, object, scalar, union } from '../src/shape.js'
import type { DriftReport, Reporter } from '../src/types.js'

const str = scalar('string')
const num = scalar('number')
const nul = scalar('null')

describe('describeShape', () => {
  it('renders compact type strings', () => {
    expect(describeShape(str)).toBe('string')
    expect(describeShape(array(num))).toBe('number[]')
    expect(describeShape(union([str, nul]))).toBe('null | string')
    expect(describeShape(object({ a: str, b: num }))).toBe('{ a, b }')
  })
})

describe('formatReport (color disabled for stable assertions)', () => {
  it('renders a no-drift report', () => {
    const report = diffReport('GET /api/x', object({ a: str }), object({ a: str }))
    const out = formatReport(report, false)
    expect(out).toContain('GET /api/x')
    expect(out).toContain('no shape drift')
  })

  it('renders each change with severity, path and transition', () => {
    const report = diffReport('GET /api/x', object({ a: str }), object({ a: num }))
    const out = formatReport(report, false)
    expect(out).toContain('[BREAKING]')
    expect(out).toContain('BREAKING')
    expect(out).toContain('a')
    expect(out).toContain('type_changed')
    expect(out).toContain('string')
    expect(out).toContain('number')
    // no ANSI escapes when color is off
    expect(out).not.toContain('\x1b[')
  })
})

describe('consoleReporter', () => {
  it('writes a formatted report to the provided sink', async () => {
    const lines: string[] = []
    const reporter = consoleReporter({ color: false, sink: (t) => lines.push(t) })
    expect(reporter.name).toBe('console')
    const report = diffReport('GET /api/x', object({ a: str }), object({ a: num }))
    await reporter.report(report)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('type_changed')
  })

  it('does not crash when `process` is absent (browser-safe color auto-detect)', async () => {
    const original = globalThis.process
    try {
      // Simulate a browser/edge runtime with no Node `process` global.
      // @ts-expect-error intentionally removing the global for the test
      delete globalThis.process
      const lines: string[] = []
      const reporter = consoleReporter({ sink: (t) => lines.push(t) }) // color auto-detected
      const report = diffReport('GET /api/x', object({ a: str }), object({ a: num }))
      await reporter.report(report)
      expect(lines[0]).not.toContain('\x1b[') // no ANSI in a non-TTY/browser
    } finally {
      globalThis.process = original
    }
  })
})

describe('runReporters pipeline', () => {
  const report: DriftReport = { endpoint: 'GET /api/x', severity: 'info', changes: [] }

  it('runs every reporter and reports no failures on success', async () => {
    const a = { name: 'a', report: vi.fn().mockResolvedValue(undefined) }
    const b = { name: 'b', report: vi.fn().mockResolvedValue(undefined) }
    const result = await runReporters([a, b], report)
    expect(a.report).toHaveBeenCalledWith(report)
    expect(b.report).toHaveBeenCalledWith(report)
    expect(result.failures).toEqual([])
  })

  it('isolates a throwing reporter without blocking the others', async () => {
    const boom: Reporter = {
      name: 'boom',
      report: () => Promise.reject(new Error('kaboom')),
    }
    const ok = { name: 'ok', report: vi.fn().mockResolvedValue(undefined) }
    const result = await runReporters([boom, ok], report)
    expect(ok.report).toHaveBeenCalledOnce()
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]!.reporter).toBe('boom')
    expect((result.failures[0]!.error as Error).message).toBe('kaboom')
  })

  it('isolates a synchronously-throwing reporter', async () => {
    const throwSync: Reporter = {
      name: 'sync',
      report: () => {
        throw new Error('sync-boom')
      },
    }
    const ok = { name: 'ok', report: vi.fn().mockResolvedValue(undefined) }
    const result = await runReporters([throwSync, ok], report)
    expect(ok.report).toHaveBeenCalledOnce()
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]!.reporter).toBe('sync')
  })
})
