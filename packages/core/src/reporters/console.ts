import type { DriftReport, Reporter } from '../types.js'
import { formatReport } from './format.js'

/** Configuration for {@link consoleReporter}. */
export interface ConsoleReporterOptions {
  /**
   * Force color on/off. When omitted, color is auto-detected: enabled on a TTY
   * unless `NO_COLOR` is set (https://no-color.org).
   */
  color?: boolean
  /** Where to write each rendered report. Default: `console.log`. */
  sink?: (text: string) => void
}

function autoColor(): boolean {
  // Browser/edge: no `process` → no ANSI. (The `.` entry is browser-safe.)
  if (typeof process === 'undefined') return false
  if (process.env?.NO_COLOR !== undefined && process.env.NO_COLOR !== '') return false
  if (process.env?.FORCE_COLOR !== undefined && process.env.FORCE_COLOR !== '') return true
  return Boolean(process.stdout?.isTTY)
}

/**
 * The default reporter: renders drift reports as colored, human-readable blocks
 * to the terminal.
 */
export function consoleReporter(options: ConsoleReporterOptions = {}): Reporter {
  const color = options.color ?? autoColor()
  const sink = options.sink ?? ((text: string) => console.log(text))
  return {
    name: 'console',
    report(drift: DriftReport): Promise<void> {
      sink(formatReport(drift, color))
      return Promise.resolve()
    },
  }
}
