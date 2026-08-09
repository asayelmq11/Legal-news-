'use client'

import { useTransition } from 'react'

import { BUTTON } from '@/components/ui'
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
      <button type="submit" disabled={pending} className={BUTTON.subtle}>
        {pending ? 'جارٍ الخروج…' : 'تسجيل الخروج'}
      </button>
    </form>
  )
}
