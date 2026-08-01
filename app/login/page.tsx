import type { Metadata } from 'next'

import { LoginForm } from './login-form'

export const metadata: Metadata = { title: 'تسجيل الدخول' }

/**
 * There is no sign-up link and no self-service "forgot password", by design:
 * accounts are created by an administrator, and a recovery email is sent by an
 * administrator. A person who cannot sign in needs an administrator, not a
 * form. The link in that email lands on /update-password.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reset?: string }>
}) {
  const { next, reset } = await searchParams

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-16">
      <div className="space-y-6 rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-raised) p-8">
        <header className="space-y-2 text-center">
          <h1 className="text-xl font-bold text-(--color-ink)">منصة الرصد القانوني</h1>
          <p className="text-sm text-(--color-ink-muted)">
            نظام داخلي للإدارة القانونية — الدخول للموظفين المصرّح لهم فقط
          </p>
        </header>

        {reset ? (
          <p
            role="status"
            className="rounded-md border border-(--color-ok) bg-(--color-ok-subtle) px-3 py-2 text-sm leading-relaxed text-(--color-ok)"
          >
            تم تحديث كلمة المرور وإنهاء جميع الجلسات السابقة. سجّل الدخول بكلمة المرور الجديدة.
          </p>
        ) : null}

        <LoginForm next={next} />
      </div>

      <p className="mt-6 text-center text-xs text-(--color-ink-subtle)">
        لا يوجد تسجيل ذاتي. تُنشأ الحسابات عن طريق مسؤول النظام.
      </p>
    </main>
  )
}
