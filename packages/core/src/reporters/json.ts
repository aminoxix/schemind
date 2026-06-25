import type { DriftReport, Reporter } from '../types.js'

/** Configuration for {@link jsonReporter}. */
export interface JsonReporterOptions {
  /** Where to write each report as a JSON line. Default: `console.log`. */
  sink?: (line: string) => void
  /** Pretty-print with this indent. Default: compact (single line). */
  indent?: number
}

/** Emits each drift report as a JSON line — ideal for machine-readable CI logs. */
export function jsonReporter(options: JsonReporterOptions = {}): Reporter {
  const sink = options.sink ?? ((line: string) => console.log(line))
  return {
    name: 'json',
    report(drift: DriftReport): Promise<void> {
      sink(JSON.stringify(drift, null, options.indent))
      return Promise.resolve()
    },
  }
}
