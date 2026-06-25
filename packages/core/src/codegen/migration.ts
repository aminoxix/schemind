import type { DriftReport, ShapeNode } from '../types.js'
import { endpointToTypeName } from './naming.js'
import { shapeToTypeScript } from './typescript.js'

const SEVERITY_MARK = { info: 'ℹ', warn: '⚠', breaking: '✖' } as const

/**
 * Emit a TypeScript migration snippet for a drift: the old and new types plus
 * a checklist of the changes. Turns a "your API broke" report into something a
 * developer can act on directly.
 */
export function generateMigration(
  report: DriftReport,
  fromShape: ShapeNode,
  toShape: ShapeNode,
): string {
  const name = endpointToTypeName(report.endpoint)
  const checklist = report.changes
    .map((c) => `//   ${SEVERITY_MARK[c.severity]} ${c.path || '(root)'} — ${c.type}`)
    .join('\n')

  return `// schemind migration — ${report.endpoint} (${report.severity})
// changes:
${checklist || '//   (no changes)'}

export type ${name}Before = ${shapeToTypeScript(fromShape)}

export type ${name}After = ${shapeToTypeScript(toShape)}
`
}
