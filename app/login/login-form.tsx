'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'

import { signIn, type LoginState } from '@/lib/auth/actions'

const INITIAL: LoginState = { error: null }

export function LoginForm({ next }: { next?: string | undefined }) {
  const [state, formAction] = useActionState(signIn, INITIAL)

  return (
    <form action={formAction} className="space-y-4">
      {next ? <input type="hidden" name="next" value={next} /> : null}

      <Field
        id="email"
        name="email"
        type="email"
        label="البريد الإلكتروني"
        autoComplete="username"
        dir="ltr"
      />
      <Field
        id="password"
        name="password"
        type="password"
        label="كلمة المرور"
        autoComplete="current-password"
        dir="ltr"
      />

      {state.error ? (
        <p
          role="alert"
          className="rounded-md border border-(--color-danger) bg-(--color-danger-subtle) px-3 py-2 text-sm text-(--color-danger)"
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
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-md bg-(--color-brand) px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-(--color-brand-hover) disabled:opacity-60"
    >
      {pending ? 'جارٍ التحقق…' : 'تسجيل الدخول'}
    </button>
  )
}

function Field({
  id,
  label,
  ...props
}: { id: string; label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-(--color-ink)">
        {label}
      </label>
      <input
        id={id}
        required
        className="w-full rounded-md border border-(--color-border-strong) bg-(--color-surface) px-3 py-2 text-sm text-(--color-ink) outline-none focus:border-(--color-brand)"
        {...props}
      />
    </div>
  )
}
