'use client'

import type { BackendTarget } from '@/lib/api'

const OPTIONS: { value: BackendTarget; label: string; port: string }[] = [
  { value: 'go', label: 'Go', port: ':8080' },
  { value: 'java', label: 'Java', port: ':8081' },
]

export function BackendSwitcher({
  current,
  onChange,
}: {
  current: BackendTarget
  onChange: (target: BackendTarget) => void
}) {
  return (
    <div className="inline-flex rounded-lg border border-zinc-200 bg-white p-0.5" role="tablist">
      {OPTIONS.map((opt) => {
        const active = opt.value === current
        return (
          <button
            key={opt.value}
            role="tab"
            aria-selected={active}
            data-testid={`backend-${opt.value}`}
            onClick={() => onChange(opt.value)}
            className={`px-3 py-1.5 text-sm rounded-md transition ${
              active ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:bg-zinc-100'
            }`}
          >
            {opt.label}
            <span className={`ml-1 text-xs ${active ? 'text-zinc-300' : 'text-zinc-400'}`}>
              {opt.port}
            </span>
          </button>
        )
      })}
    </div>
  )
}
