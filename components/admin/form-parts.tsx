'use client'

import { useFormStatus } from 'react-dom'

import type { ActionState } from '@/lib/admin/actions'
import { cn } from '@/lib/utils'

export function SubmitButton({
  children,
  pendingLabel = 'جارٍ الحفظ…',
  variant = 'primary',
  confirm,
}: {
  children: React.ReactNode
  pendingLabel?: string | undefined
  variant?: 'primary' | 'ghost' | 'danger'
  /** Native confirm text for actions that change availability or are hard to undo. */
  confirm?: string | undefined
}) {
  const { pending } = useFormStatus()

  const styles = {
    primary: 'bg-(--color-brand) text-white hover:bg-(--color-brand-hover)',
    ghost:
      'border border-(--color-border-strong) text-(--color-ink-muted) hover:bg-(--color-surface-sunken)',
    danger: 'bg-(--color-danger) text-white hover:opacity-90',
  }[variant]

  return (
    <button
      type="submit"
      disabled={pending}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault()
      }}
      className={cn(
        'rounded-md px-3 py-1.5 text-sm font-semibold transition-colors disabled:opacity-60',
        styles,
      )}
    >
      {pending ? pendingLabel : children}
    </button>
  )
}

export function ActionMessage({ state }: { state: ActionState }) {
  if (!state.message) return null
  return (
    <p
      role="status"
      className={cn(
        'rounded-md px-3 py-2 text-sm',
        state.ok
          ? 'bg-(--color-ok-subtle) text-(--color-ok)'
          : 'bg-(--color-danger-subtle) text-(--color-danger)',
      )}
    >
      {state.message}
    </p>
  )
}

export function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string
  label: string
  hint?: string
  error?: string | undefined
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-(--color-ink)">
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs text-(--color-ink-subtle)">{hint}</p> : null}
      {error ? <p className="text-xs text-(--color-danger)">{error}</p> : null}
    </div>
  )
}

export const inputClass =
  'w-full rounded-md border border-(--color-border-strong) bg-(--color-surface) px-3 py-2 text-sm outline-none focus:border-(--color-brand)'
