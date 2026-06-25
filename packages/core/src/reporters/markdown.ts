import type { DriftReport } from '../types.js'
import { describeShape } from './format.js'

const SEVERITY_EMOJI = { info: '🔵', warn: '🟡', breaking: '🔴' } as const

/** One-line transition description for a change (`from → to`). */
function transition(
  from?: DriftReport['changes'][number]['from'],
  to?: DriftReport['changes'][number]['to'],
): string {
  const f = from ? `\`${describeShape(from)}\`` : null
  const t = to ? `\`${describeShape(to)}\`` : null
  if (f && t) return `${f} → ${t}`
  if (t) return `+ ${t}`
  if (f) return `− ${f}`
  return ''
}

/** Render one report as a GitHub-flavored markdown section with a change table. */
export function reportToMarkdown(report: DriftReport): string {
  const header = `### ${SEVERITY_EMOJI[report.severity]} \`${report.endpoint}\` — **${report.severity}**`
  if (report.changes.length === 0) return `${header}\n\n_no shape drift_`
  const rows = report.changes
    .map(
      (c) =>
        `| \`${c.path || '(root)'}\` | ${c.type} | ${SEVERITY_EMOJI[c.severity]} ${c.severity} | ${transition(c.from, c.to)} |`,
    )
    .join('\n')
  return `${header}\n\n| path | change | severity | shape |\n|---|---|---|---|\n${rows}`
}

/** Aggregate many reports into a single markdown document (used for PR comments). */
export function driftToMarkdown(reports: readonly DriftReport[]): string {
  if (reports.length === 0) return '### schemind\n\n✅ no API shape drift detected.'
  const counts = { info: 0, warn: 0, breaking: 0 }
  for (const r of reports) counts[r.severity]++
  const summary = `**${reports.length}** endpoint(s) drifted — 🔴 ${counts.breaking} · 🟡 ${counts.warn} · 🔵 ${counts.info}`
  return `## schemind — API shape drift\n\n${summary}\n\n${reports.map(reportToMarkdown).join('\n\n')}`
}
