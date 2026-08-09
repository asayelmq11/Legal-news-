'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'

import { MailIcon } from '@/components/icons'
import { BUTTON, CONTROL } from '@/components/ui'
import { requestPasswordReset, type RequestResetState } from '@/lib/auth/actions'
import { cn } from '@/lib/utils'

const INITIAL: RequestResetState = { status: 'idle' }

export function ForgotPasswordForm() {
  const [state, formAction] = useActionState(requestPasswordReset, INITIAL)

  if (state.status === 'sent') {
    return <Sent />
  }

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="email" className="block text-sm font-medium text-(--color-ink)">
          البريد الإلكتروني
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="username"
          dir="ltr"
          className={cn(CONTROL, 'w-full')}
        />
      </div>

      {state.status === 'failed' ? (
        <p
          role="alert"
          className="rounded-(--radius-control) border border-(--color-danger) bg-(--color-danger-subtle) px-3 py-2 text-sm leading-relaxed text-(--color-danger)"
        >
          {state.error}
        </p>
      ) : null}

      <SubmitButton />

      <Link
        href="/login"
        className="block text-center text-sm font-medium text-(--color-ink-muted) transition-colors hover:text-(--color-ink)"
      >
        العودة إلى تسجيل الدخول
      </Link>
    </form>
  )
}

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending} className={cn(BUTTON.primary, 'w-full')}>
      {pending ? 'جارٍ الإرسال…' : 'إرسال رابط إعادة التعيين'}
    </button>
  )
}

function Sent() {
  return (
    <div className="space-y-4 text-center">
      <div className="mx-auto flex size-11 items-center justify-center rounded-full bg-(--color-ok-subtle) text-(--color-ok)">
        <MailIcon className="size-5" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-(--color-ink)">تحقق من بريدك</p>
        <p className="text-sm leading-relaxed text-(--color-ink-muted)">
          إذا كان البريد الإلكتروني مسجَّلاً لدينا، فسيصلك رابط لإعادة تعيين كلمة المرور خلال دقائق.
          افتح الرابط من نفس المتصفح لإتمام العملية.
        </p>
      </div>
      <Link href="/login" className={cn(BUTTON.ghost, 'w-full')}>
        العودة إلى تسجيل الدخول
      </Link>
    </div>
  )
}
