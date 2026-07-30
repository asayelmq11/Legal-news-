import type { Metadata } from 'next'

import { StatusScreen } from '@/components/status-screen'
import { SignOutButton } from '@/components/sign-out-button'

export const metadata: Metadata = { title: 'لا يوجد وصول' }

/**
 * Two distinct situations, deliberately kept apart:
 *
 *   not_provisioned — authenticated with Supabase but no public.users row. The
 *                     platform has no self-provisioning, so this is someone who
 *                     has an account but was never granted access.
 *   inactive        — had access, and it was withdrawn.
 *
 * Collapsing them into one "access denied" would leave a deactivated employee
 * and a never-authorised one with the same unhelpful message.
 */
export default async function NoAccessPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>
}) {
  const { reason } = await searchParams
  const inactive = reason === 'inactive'

  return (
    <>
      <StatusScreen
        tone="warn"
        title={inactive ? 'الحساب موقوف' : 'لا تملك صلاحية الوصول'}
        body={
          inactive
            ? 'تم إيقاف حسابك في المنصة. إن كنت تعتقد أن هذا خطأ، تواصل مع مسؤول النظام في الإدارة القانونية لإعادة تفعيله.'
            : 'حسابك موجود لكنه غير مُصرَّح له بالدخول إلى المنصة. هذا نظام داخلي مغلق ولا يوجد فيه تسجيل ذاتي — يجب أن يضيفك مسؤول النظام أولاً.'
        }
        detail={
          <p className="text-xs text-(--color-ink-subtle)">
            {inactive
              ? 'يسري الإيقاف فوراً على مستوى قاعدة البيانات، ولا يمنح إعادة تسجيل الدخول أي صلاحية.'
              : 'لن يؤدي تكرار تسجيل الدخول إلى منحك صلاحية.'}
          </p>
        }
      />
      <div className="mx-auto max-w-lg px-6 pb-16 text-center">
        <SignOutButton />
      </div>
    </>
  )
}
