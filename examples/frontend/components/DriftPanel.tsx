'use client'

import type { DriftReport } from '@/lib/schemind'
import { Activity } from 'lucide-react'

export interface DriftEntry {
  id: number
  endpoint: string
  report: DriftReport | null
  created: boolean
  at: string
}

const SEVERITY_STYLE: Record<string, string> = {
  info: 'bg-sky-100 text-sky-700',
  warn: 'bg-amber-100 text-amber-700',
  breaking: 'bg-red-100 text-red-700',
}

export function DriftPanel({ entries, onClear }: { entries: DriftEntry[]; onClear: () => void }) {
  return (
    <aside
      data-testid="drift-panel"
      className="bg-white rounded-xl border border-zinc-200 p-4 flex flex-col gap-3 h-fit sticky top-24"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity size={16} className="text-zinc-700" />
          <h2 className="font-semibold text-sm text-zinc-900">schemind</h2>
        </div>
        {entries.length > 0 && (
          <button onClick={onClear} className="text-xs text-zinc-400 hover:text-zinc-700">
            Clear
          </button>
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
              className="border border-zinc-100 rounded-lg p-2.5 text-xs"
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <code className="text-zinc-700 truncate">{entry.endpoint}</code>
                {entry.created ? (
                  <span className="shrink-0 px-1.5 py-0.5 rounded-full bg-zinc-100 text-zinc-500">
                    baseline
                  </span>
                ) : (
                  <span
                    data-testid="drift-severity"
                    className={`shrink-0 px-1.5 py-0.5 rounded-full uppercase tracking-wide ${
                      SEVERITY_STYLE[entry.report?.severity ?? 'info']
                    }`}
                  >
                    {entry.report?.severity}
                  </span>
                )}
              </div>
              {entry.report && entry.report.changes.length > 0 && (
                <ul className="flex flex-col gap-0.5 text-zinc-500">
                  {entry.report.changes.map((change, i) => (
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
