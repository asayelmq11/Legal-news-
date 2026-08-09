import type { Metadata } from 'next'
import Link from 'next/link'

import { AuthShell } from '@/components/ui'
import { LoginForm } from './login-form'

export const metadata: Metadata = { title: 'تسجيل الدخول' }

/**
 * There is no sign-up link, by design: accounts are created by an
 * administrator. Password recovery, however, is self-service — the "نسيت كلمة
 * المرور؟" link below leads to /forgot-password, which asks Supabase to send
 * the existing recovery email. That email's link still lands on
 * /update-password and is handled entirely by RecoveryForm/updatePassword;
 * nothing about that path changes here.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reset?: string }>
}) {
  const { next, reset } = await searchParams

  return (
    <AuthShell
      title="منصة الرصد القانوني"
      subtitle="نظام داخلي للإدارة القانونية — الدخول للموظفين المصرّح لهم فقط"
      footer="لا يوجد تسجيل ذاتي. تُنشأ الحسابات عن طريق مسؤول النظام."
    >
      {reset ? (
        <p
          role="status"
          className="rounded-(--radius-control) border border-(--color-ok) bg-(--color-ok-subtle) px-3 py-2 text-sm leading-relaxed text-(--color-ok)"
        >
          تم تحديث كلمة المرور وإنهاء جميع الجلسات السابقة. سجّل الدخول بكلمة المرور الجديدة.
        </p>
      ) : null}

      <LoginForm next={next} />

      <Link
        href="/forgot-password"
        className="block rounded-(--radius-control) border border-(--color-border) px-3 py-2.5 text-center text-sm font-medium text-(--color-ink-muted) transition-colors hover:bg-(--color-surface-sunken) hover:text-(--color-ink)"
      >
        هل نسيت كلمة المرور؟
      </Link>
    </AuthShell>
  )
}
