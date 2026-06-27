'use client'

import { Button } from '@/components/ui/button'
import type { DriftChange, DriftReport, ObserveSource } from '@/lib/schemind'
import { Activity } from 'lucide-react'

export interface DriftEntry {
  id: number
  endpoint: string
  report: DriftReport | null
  created: boolean
  source: ObserveSource
  at: string
}

const SEVERITY_STYLE: Record<string, string> = {
  info: 'bg-sky-100 text-sky-700',
  warn: 'bg-amber-100 text-amber-700',
  breaking: 'bg-red-100 text-red-700',
}

const SOURCE_STYLE: Record<ObserveSource, string> = {
  fetch: 'bg-zinc-100 text-zinc-600',
  tanstack: 'bg-indigo-100 text-indigo-700',
}

export function DriftPanel({ entries, onClear }: { entries: DriftEntry[]; onClear: () => void }) {
  return (
    <aside
      data-testid="drift-panel"
      className="sticky top-24 flex h-fit flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity size={16} className="text-zinc-700" />
          <h2 className="font-semibold text-sm text-zinc-900">schemind</h2>
        </div>
        {entries.length > 0 && (
          <Button variant="ghost" size="sm" onClick={onClear}>
            Clear
          </Button>
        )}
      </div>

      {entries.length === 0 ? (
        <p data-testid="drift-empty" className="text-xs text-zinc-400">
          Watching API responses… switch drift mode and refresh to see detected changes.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {entries.map((entry) => (
            <li
              key={entry.id}
              data-testid="drift-entry"
              data-severity={entry.report?.severity ?? (entry.created ? 'baseline' : 'none')}
              className="rounded-lg border border-zinc-100 p-2.5 text-xs"
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span
                    data-testid="drift-source"
                    data-source={entry.source}
                    className={`shrink-0 rounded-full px-1.5 py-0.5 font-medium text-[10px] uppercase tracking-wide ${SOURCE_STYLE[entry.source] ?? ''}`}
                  >
                    {entry.source}
                  </span>
                  <code className="truncate text-zinc-700">{entry.endpoint}</code>
                </div>
                {entry.created ? (
                  <span className="shrink-0 rounded-full bg-zinc-100 px-1.5 py-0.5 text-zinc-500">
                    baseline
                  </span>
                ) : (
                  <span
                    data-testid="drift-severity"
                    className={`shrink-0 rounded-full px-1.5 py-0.5 uppercase tracking-wide ${
                      SEVERITY_STYLE[entry.report?.severity ?? 'info']
                    }`}
                  >
                    {entry.report?.severity}
                  </span>
                )}
              </div>
              {entry.report && entry.report.changes.length > 0 && (
                <ul className="flex flex-col gap-0.5 text-zinc-500">
                  {entry.report.changes.map((change: DriftChange, i: number) => (
                    <li key={i} data-testid="drift-change">
                      <span className="text-zinc-800">{change.path || '(root)'}</span> ·{' '}
                      {change.type}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}
