import type { DriftChange, DriftReport, Severity, ShapeNode } from '../types.js'

/* -------------------------------------------------------------------------- */
/*  Minimal, dependency-free ANSI styling                                      */
/* -------------------------------------------------------------------------- */

const CODES = {
  reset: 0,
  bold: 1,
  dim: 2,
  red: 31,
  green: 32,
  yellow: 33,
  blue: 34,
  cyan: 36,
  gray: 90,
} as const

type StyleName = keyof typeof CODES

/** Wrap text in an ANSI style, or return it unchanged when `enabled` is false. */
export function style(text: string, name: StyleName, enabled: boolean): string {
  if (!enabled) return text
  return `[${CODES[name]}m${text}[${CODES.reset}m`
}

const SEVERITY_STYLE: Readonly<Record<Severity, StyleName>> = {
  info: 'cyan',
  warn: 'yellow',
  breaking: 'red',
}

const SEVERITY_LABEL: Readonly<Record<Severity, string>> = {
  info: 'INFO',
  warn: 'WARN',
  breaking: 'BREAKING',
}

/** Render a shape as a compact human-readable type string, e.g. `string | null`. */
export function describeShape(node: ShapeNode): string {
  switch (node.kind) {
    case 'scalar':
      return node.type
    case 'array':
      return `${describeShape(node.items)}[]`
    case 'object': {
      const keys = Object.keys(node.fields)
      return keys.length === 0 ? '{}' : `{ ${keys.join(', ')} }`
    }
    case 'union':
      return node.types.length === 0 ? 'unknown' : node.types.map(describeShape).join(' | ')
  }
}

function describeChange(change: DriftChange, color: boolean): string {
  const sev = style(SEVERITY_LABEL[change.severity], SEVERITY_STYLE[change.severity], color)
  const path = style(change.path || '(root)', 'bold', color)
  const detail = transition(change, color)
  return `  ${sev}  ${path} — ${change.type}${detail ? ` (${detail})` : ''}`
}

function transition(change: DriftChange, color: boolean): string {
  const from = change.from ? describeShape(change.from) : null
  const to = change.to ? describeShape(change.to) : null
  const arrow = style('→', 'gray', color)
  if (from && to) return `${from} ${arrow} ${to}`
  if (to) return `+ ${to}`
  if (from) return `- ${from}`
  return ''
}

/**
 * Render a {@link DriftReport} into a multi-line, optionally-colored block.
 * Pure — no I/O — so it is trivially unit-testable.
 */
export function formatReport(report: DriftReport, color: boolean): string {
  const header = `${style('schemind', 'bold', color)} ${style(report.endpoint, 'blue', color)}  ${style(`[${SEVERITY_LABEL[report.severity]}]`, SEVERITY_STYLE[report.severity], color)}`

  if (report.changes.length === 0) {
    return `${header}\n  ${style('no shape drift', 'green', color)}`
  }

  const lines = report.changes.map((c) => describeChange(c, color))
  const count = style(
    `${report.changes.length} change${report.changes.length === 1 ? '' : 's'}`,
    'dim',
    color,
  )
  return `${header}  ${count}\n${lines.join('\n')}`
}
