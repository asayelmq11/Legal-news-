import type { Metadata } from 'next'

import { StatusScreen } from '@/components/status-screen'
import { SignOutButton } from '@/components/sign-out-button'

export const metadata: Metadata = { title: 'لا يوجد وصول' }

/**
 * Three distinct situations, deliberately kept apart:
 *
 *   not_provisioned  — authenticated with Supabase but no public.users row. The
 *                      platform has no self-provisioning, so this is someone
 *                      who has an account but was never granted access.
 *   inactive         — had access, and it was withdrawn.
 *   auth_unavailable — Supabase Auth could not be reached. Nobody's access
 *                      changed; the service is down. Sending this person to the
 *                      login form would be a lie — signing in again calls the
 *                      same unreachable service.
 *
 * Collapsing them into one "access denied" would leave a deactivated employee,
 * a never-authorised one, and an outage with the same unhelpful message.
 */
const SCREENS = {
  inactive: {
    title: 'الحساب موقوف',
    body: 'تم إيقاف حسابك في المنصة. إن كنت تعتقد أن هذا خطأ، تواصل مع مسؤول النظام في الإدارة القانونية لإعادة تفعيله.',
    detail: 'يسري الإيقاف فوراً على مستوى قاعدة البيانات، ولا يمنح إعادة تسجيل الدخول أي صلاحية.',
  },
  auth_unavailable: {
    title: 'تعذّر الوصول إلى خدمة المصادقة',
    body: 'لم تتمكن المنصة من الاتصال بخدمة المصادقة للتحقق من جلستك. هذه مشكلة في الاتصال أو في الخدمة، وليست تغييراً في صلاحياتك.',
    detail: 'أعد المحاولة بعد قليل. إن استمر الخطأ، تواصل مع مسؤول النظام — تسجيل الدخول من جديد لن يحل المشكلة.',
  },
  not_provisioned: {
    title: 'لا تملك صلاحية الوصول',
    body: 'حسابك موجود لكنه غير مُصرَّح له بالدخول إلى المنصة. هذا نظام داخلي مغلق ولا يوجد فيه تسجيل ذاتي — يجب أن يضيفك مسؤول النظام أولاً.',
    detail: 'لن يؤدي تكرار تسجيل الدخول إلى منحك صلاحية.',
  },
} as const

export default async function NoAccessPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>
}) {
  const { reason } = await searchParams
  const screen =
    reason === 'inactive'
      ? SCREENS.inactive
      : reason === 'auth_unavailable'
        ? SCREENS.auth_unavailable
        : SCREENS.not_provisioned

  return (
    <>
      <StatusScreen
        tone="warn"
        title={screen.title}
        body={screen.body}
        detail={<p className="text-xs text-(--color-ink-subtle)">{screen.detail}</p>}
      />
      <div className="mx-auto max-w-lg px-6 pb-16 text-center">
        <SignOutButton />
      </div>
    </>
  )
}
