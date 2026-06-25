import type { CodegenSnapshot } from './codegen/types.js'
import { diffReport } from './diff.js'
import { highestSeverity } from './severity.js'
import type { DriftReport, Severity } from './types.js'

/** Result of comparing two sets of endpoint shapes (e.g. staging vs prod). */
export interface SetComparison {
  /** Drift reports for endpoints present in both sets, in `base` order. */
  reports: DriftReport[]
  /** Highest severity across {@link reports} (`info` when none). */
  severity: Severity
  /** Endpoints only in `base`. */
  onlyInBase: string[]
  /** Endpoints only in `target`. */
  onlyInTarget: string[]
}

/**
 * Diff two sets of endpoint shapes — the engine behind multi-environment
 * comparison (`schm compare --from staging --to prod`). Shared endpoints are
 * diffed; endpoints unique to either side are listed.
 */
export function compareShapeSets(
  base: readonly CodegenSnapshot[],
  target: readonly CodegenSnapshot[],
): SetComparison {
  const baseMap = new Map(base.map((s) => [s.endpoint, s.shape]))
  const targetMap = new Map(target.map((s) => [s.endpoint, s.shape]))

  const reports: DriftReport[] = []
  for (const [endpoint, baseShape] of baseMap) {
    const targetShape = targetMap.get(endpoint)
    if (targetShape === undefined) continue
    const report = diffReport(endpoint, baseShape, targetShape)
    if (report.changes.length > 0) reports.push(report)
  }

  return {
    reports,
    severity: highestSeverity(reports.map((r) => r.severity)),
    onlyInBase: [...baseMap.keys()].filter((e) => !targetMap.has(e)),
    onlyInTarget: [...targetMap.keys()].filter((e) => !baseMap.has(e)),
  }
}
