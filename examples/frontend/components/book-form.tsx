'use client'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { type Book, type BookInput, bookFormSchema, toBookInput } from '@/lib/types'
import { useForm } from '@tanstack/react-form'
import type { ReactNode } from 'react'

export function BookForm({
  open,
  onOpenChange,
  initial,
  onSubmit,
  submitting,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initial?: Book
  onSubmit: (payload: BookInput) => Promise<void>
  submitting?: boolean
}) {
  const form = useForm({
    defaultValues: {
      title: initial?.title ?? '',
      authorName: initial?.author?.name ?? '',
      country: initial?.author?.country ?? '',
      tags: (initial?.tags ?? []).join(', '),
      rating: initial?.rating ?? 4,
    },
    // Zod 3.24+ implements the Standard Schema spec, so the schema doubles as the
    // form validator — one source of truth for both the types and the rules.
    validators: { onChange: bookFormSchema },
    onSubmit: async ({ value }) => {
      await onSubmit(toBookInput(value))
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="book-form">
        <DialogHeader>
          <DialogTitle>{initial ? 'Edit book' : 'Add book'}</DialogTitle>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            e.stopPropagation()
            void form.handleSubmit()
          }}
          className="flex flex-col gap-4"
        >
          <form.Field name="title">
            {(field) => (
              <Fieldset label="Title" errors={field.state.meta.errors}>
                <Input
                  data-testid="field-title"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
              </Fieldset>
            )}
          </form.Field>

          <div className="grid grid-cols-2 gap-3">
            <form.Field name="authorName">
              {(field) => (
                <Fieldset label="Author" errors={field.state.meta.errors}>
                  <Input
                    data-testid="field-author"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                </Fieldset>
              )}
            </form.Field>

            <form.Field name="country">
              {(field) => (
                <Fieldset label="Country" errors={field.state.meta.errors}>
                  <Input
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                </Fieldset>
              )}
            </form.Field>
          </div>

          <form.Field name="tags">
            {(field) => (
              <Fieldset label="Tags (comma separated)" errors={field.state.meta.errors}>
                <Input
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
              </Fieldset>
            )}
          </form.Field>

          <form.Field name="rating">
            {(field) => (
              <Fieldset label="Rating" errors={field.state.meta.errors}>
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  max="5"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.valueAsNumber)}
                />
              </Fieldset>
            )}
          </form.Field>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <form.Subscribe
              selector={(s) => ({ canSubmit: s.canSubmit, isSubmitting: s.isSubmitting })}
            >
              {({ canSubmit, isSubmitting }) => (
                <Button type="submit" data-testid="submit-book" disabled={!canSubmit || submitting}>
                  {isSubmitting || submitting ? 'Saving…' : 'Save'}
                </Button>
              )}
            </form.Subscribe>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Fieldset({
  label,
  errors,
  children,
}: {
  label: string
  errors: readonly unknown[]
  children: ReactNode
}) {
  const message = firstError(errors)
  return (
    <div className="flex flex-col gap-1">
      <Label>{label}</Label>
      {children}
      {message && <span className="text-red-500 text-xs">{message}</span>}
    </div>
  )
}

/** Standard-schema validators surface issues as `{ message }`; tolerate raw strings too. */
function firstError(errors: readonly unknown[]): string | null {
  const first = errors.find(Boolean)
  if (!first) return null
  if (typeof first === 'string') return first
  if (typeof first === 'object' && 'message' in first)
    return String((first as { message: unknown }).message)
  return String(first)
}
