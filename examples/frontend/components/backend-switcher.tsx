'use client'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { BackendTarget } from '@/lib/types'

const OPTIONS: { value: BackendTarget; label: string }[] = [
  { value: 'go', label: 'Go · :8080' },
  { value: 'java', label: 'Java · :8081' },
]

export function BackendSwitcher({
  value,
  onChange,
}: {
  value: BackendTarget
  onChange: (value: BackendTarget) => void
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as BackendTarget)}>
      <SelectTrigger data-testid="backend-select" className="w-[150px]" aria-label="Backend">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {OPTIONS.map((o) => (
          <SelectItem key={o.value} value={o.value} data-testid={`backend-${o.value}`}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
