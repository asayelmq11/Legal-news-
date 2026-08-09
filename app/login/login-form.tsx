'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'

import { PasswordField } from '@/components/password-field'
import { BUTTON, CONTROL } from '@/components/ui'
import { signIn, type LoginState } from '@/lib/auth/actions'
import { cn } from '@/lib/utils'

const INITIAL: LoginState = { status: 'idle' }

export function LoginForm({ next }: { next?: string | undefined }) {
  const [state, formAction] = useActionState(signIn, INITIAL)

  return (
    <form action={formAction} className="space-y-4">
      {next ? <input type="hidden" name="next" value={next} /> : null}

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

      <PasswordField
        id="password"
        name="password"
        label="كلمة المرور"
        autoComplete="current-password"
      />

      {state.status === 'failed' ? (
        <p
          role="alert"
          className="rounded-(--radius-control) border border-(--color-danger) bg-(--color-danger-subtle) px-3 py-2 text-sm leading-relaxed text-(--color-danger)"
        >
          {state.error}
        </p>
      ) : null}

      <SubmitButton />
    </form>
  )
}

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending} className={cn(BUTTON.primary, 'w-full')}>
      {pending ? 'جارٍ التحقق…' : 'تسجيل الدخول'}
    </button>
  )
}
