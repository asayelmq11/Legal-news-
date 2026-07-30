import type { Metadata } from 'next'

import { LoginForm } from './login-form'

export const metadata: Metadata = { title: 'تسجيل الدخول' }

/**
 * There is no sign-up link and no password-reset self-service, by design:
 * accounts are created by an administrator. A person who cannot sign in needs
 * an administrator, not a form.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { next } = await searchParams

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-16">
      <div className="space-y-6 rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-raised) p-8">
        <header className="space-y-2 text-center">
          <h1 className="text-xl font-bold text-(--color-ink)">منصة الرصد القانوني</h1>
          <p className="text-sm text-(--color-ink-muted)">
            نظام داخلي للإدارة القانونية — الدخول للموظفين المصرّح لهم فقط
          </p>
        </header>

        <LoginForm next={next} />
      </div>

      <p className="mt-6 text-center text-xs text-(--color-ink-subtle)">
        لا يوجد تسجيل ذاتي. تُنشأ الحسابات عن طريق مسؤول النظام.
      </p>
    </main>
  )
}
