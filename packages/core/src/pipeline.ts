import type { DriftReport, Reporter } from './types.js'

/** A failure from a single reporter, captured so it can't break the pipeline. */
export interface ReporterFailure {
  reporter: string
  error: unknown
}

/** Outcome of running a report through the pipeline. */
export interface PipelineResult {
  /** Reporters that threw or rejected, in run order. Empty on full success. */
  failures: ReporterFailure[]
}

/**
 * Fan a single {@link DriftReport} out to every reporter.
 *
 * Reporters run concurrently and are fully isolated: one throwing or rejecting
 * never prevents the others from running. Failures are collected and returned
 * rather than thrown — emitting a report must never crash the host process.
 */
export async function runReporters(
  reporters: readonly Reporter[],
  drift: DriftReport,
): Promise<PipelineResult> {
  const settled = await Promise.allSettled(
    reporters.map((r) => Promise.resolve().then(() => r.report(drift))),
  )

  const failures: ReporterFailure[] = []
  settled.forEach((result, i) => {
    if (result.status === 'rejected') {
      failures.push({ reporter: reporters[i]!.name, error: result.reason })
    }
  })

  return { failures }
}
