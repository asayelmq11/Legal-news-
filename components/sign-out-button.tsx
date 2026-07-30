'use client'

import { useTransition } from 'react'

import { signOut } from '@/lib/auth/actions'

export function SignOutButton() {
  const [pending, startTransition] = useTransition()

  return (
    <form
      action={() => {
        startTransition(async () => {
          await signOut()
        })
      }}
    >
      <button
        type="submit"
        disabled={pending}
        className="rounded-md px-3 py-1.5 text-sm font-medium text-(--color-ink-muted) transition-colors hover:bg-(--color-surface-sunken) hover:text-(--color-ink) disabled:opacity-50"
      >
        {pending ? 'جارٍ الخروج…' : 'تسجيل الخروج'}
      </button>
    </form>
  )
}
