'use client'

import { cn } from '@/lib/utils'
import * as LabelPrimitive from '@radix-ui/react-label'
import * as React from 'react'

export const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn('text-sm font-medium text-zinc-600 leading-none', className)}
    {...props}
  />
))
Label.displayName = LabelPrimitive.Root.displayName
