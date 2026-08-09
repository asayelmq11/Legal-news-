'use client'

import Link from 'next/link'
import { useActionState, useEffect, useState } from 'react'
import { useFormStatus } from 'react-dom'

import { PasswordField } from '@/components/password-field'
import { BUTTON } from '@/components/ui'
import { updatePassword, type UpdatePasswordState } from '@/lib/auth/actions'
import { PASSWORD_MIN, describePasswordProblem } from '@/lib/auth/password'
import { parseRecoveryFragment, recoveryErrorMessage } from '@/lib/auth/recovery'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

const INITIAL: UpdatePasswordState = { status: 'idle' }

type Gate =
  | { phase: 'checking' }
  | { phase: 'ready' }
  | { phase: 'rejected'; message: string }

/**
 * Turns a recovery link into a usable session, then lets the user set a
 * password.
 *
 * The fragment is read once, on mount, and erased from the address bar in the
 * same tick — before any render that could put it in a screenshot, a bookmark,
 * a referrer, or a browser history entry. It is handed to the Supabase client
 * and to nothing else. There is not a single logging call in this file, and
 * there must not be: a fragment carries a live access token and refresh token.
 *
 * Once setSession() succeeds, @supabase/ssr has written the session to cookies,
 * so the Server Action that follows sees it without the tokens ever being put
 * in a form field or a request body of our own.
 */
export function RecoveryForm() {
  const [gate, setGate] = useState<Gate>({ phase: 'checking' })
  const [state, formAction] = useActionState(updatePassword, INITIAL)

  useEffect(() => {
    let cancelled = false

    async function establishSession() {
      const fragment = parseRecoveryFragment(window.location.hash)

      // Erase it immediately, whatever it turned out to be.
      if (window.location.hash) {
        window.history.replaceState(null, '', window.location.pathname)
      }

      if (fragment.kind === 'error') {
        if (!cancelled) setGate({ phase: 'rejected', message: recoveryErrorMessage(fragment.code) })
        return
      }

      const supabase = createClient()

      if (fragment.kind === 'recovery') {
        const { error } = await supabase.auth.setSession({
          access_token: fragment.accessToken,
          refresh_token: fragment.refreshToken,
        })
        if (cancelled) return
        setGate(
          error
            ? { phase: 'rejected', message: recoveryErrorMessage('otp_expired') }
            : { phase: 'ready' },
        )
        return
      }

      /*
       * No fragment. Either the page was reloaded after the hash was cleared —
       * in which case the session is already in cookies and the form should
       * still work — or somebody navigated here directly, which is not a
       * recovery at all.
       */
      const { data } = await supabase.auth.getUser()
      if (cancelled) return
      setGate(
        data.user
          ? { phase: 'ready' }
          : {
              phase: 'rejected',
              message:
                'لا يوجد رابط إعادة تعيين صالح. افتح الرابط المُرسل إلى بريدك، أو اطلب من مسؤول النظام إرسال رابط جديد.',
            },
      )
    }

    void establishSession()
    return () => {
      cancelled = true
    }
  }, [])

  if (gate.phase === 'checking') {
    return (
      <p className="flex items-center justify-center gap-2 py-2 text-sm text-(--color-ink-muted)">
        <span
          aria-hidden="true"
          className="size-3.5 animate-spin rounded-full border-2 border-(--color-border-strong) border-t-(--color-brand)"
        />
        جارٍ التحقق من الرابط…
      </p>
    )
  }

  if (gate.phase === 'rejected') {
    return <Rejected message={gate.message} />
  }

  // The action redirects on success, so a returned state is always a failure.
  if (state.status === 'no_session') {
    return <Rejected message="انتهت صلاحية جلسة إعادة التعيين. اطلب رابطاً جديداً من مسؤول النظام." />
  }

  return <PasswordFields formAction={formAction} state={state} />
}

function Rejected({ message }: { message: string }) {
  return (
    <div className="space-y-4">
      <p
        role="alert"
        className="rounded-(--radius-control) border border-(--color-danger) bg-(--color-danger-subtle) px-3 py-2 text-sm leading-relaxed text-(--color-danger)"
      >
        {message}
      </p>
      <Link href="/login" className={cn(BUTTON.ghost, 'w-full')}>
        العودة إلى تسجيل الدخول
      </Link>
    </div>
  )
}

function PasswordFields({
  formAction,
  state,
}: {
  formAction: (formData: FormData) => void
  state: UpdatePasswordState
}) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')

  // Feedback only — the Server Action re-validates with the same schema.
  const touched = password.length > 0 && confirm.length > 0
  const problem = touched ? describePasswordProblem(password, confirm) : null

  return (
    <form action={formAction} className="space-y-4">
      <PasswordField
        id="password"
        name="password"
        label="كلمة المرور الجديدة"
        autoComplete="new-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      <PasswordField
        id="confirm"
        name="confirm"
        label="تأكيد كلمة المرور"
        autoComplete="new-password"
        value={confirm}
        onChange={(event) => setConfirm(event.target.value)}
      />

      <p className="text-xs text-(--color-ink-subtle)">
        {PASSWORD_MIN} خانة على الأقل، وتحتوي على حرف ورقم.
      </p>

      {problem ? (
        <p className="text-sm text-(--color-warn)" role="status">
          {problem}
        </p>
      ) : null}

      {state.status === 'failed' ? (
        <p
          role="alert"
          className="rounded-(--radius-control) border border-(--color-danger) bg-(--color-danger-subtle) px-3 py-2 text-sm leading-relaxed text-(--color-danger)"
        >
          {state.error}
        </p>
      ) : null}

      <SubmitButton disabled={Boolean(problem) || !touched} />
    </form>
  )
}

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending || disabled} className={cn(BUTTON.primary, 'w-full')}>
      {pending ? 'جارٍ الحفظ…' : 'حفظ كلمة المرور'}
    </button>
  )
}
