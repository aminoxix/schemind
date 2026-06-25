import type { DriftReport, Reporter } from '../types.js'

/** Minimal structural subset of an OpenTelemetry span. */
export interface OtelSpan {
  setAttribute(key: string, value: string | number | boolean): void
  end(): void
}

/** Minimal structural subset of an OpenTelemetry tracer (`trace.getTracer('schemind')`). */
export interface OtelTracer {
  startSpan(name: string): OtelSpan
}

/** Configuration for {@link otelReporter}. */
export interface OtelReporterOptions {
  /** Pass your app's tracer, e.g. `trace.getTracer('schemind')`. */
  tracer: OtelTracer
  /** Span name. Default `schemind.drift`. */
  spanName?: string
}

/**
 * Emits an OpenTelemetry span per drift report with severity and change count as
 * attributes — so API shape changes correlate with your existing traces. No
 * hard `@opentelemetry/api` dependency: pass any structurally-compatible tracer.
 */
export function otelReporter(options: OtelReporterOptions): Reporter {
  const spanName = options.spanName ?? 'schemind.drift'
  return {
    name: 'otel',
    report(drift: DriftReport): Promise<void> {
      const span = options.tracer.startSpan(spanName)
      span.setAttribute('schemind.endpoint', drift.endpoint)
      span.setAttribute('schemind.severity', drift.severity)
      span.setAttribute('schemind.change_count', drift.changes.length)
      span.end()
      return Promise.resolve()
    },
  }
}
