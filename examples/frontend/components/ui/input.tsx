import { cn } from '@/lib/utils'
import * as React from 'react'

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      'flex h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 py-1 text-sm text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus-visible:border-zinc-400 disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}
  />
))
Input.displayName = 'Input'
