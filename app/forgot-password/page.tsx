import type { Metadata } from 'next'

import { AuthShell } from '@/components/ui'
import { ForgotPasswordForm } from './forgot-password-form'

export const metadata: Metadata = { title: 'استعادة كلمة المرور' }

/**
 * Entry point for the existing Supabase recovery flow — this page only asks
 * Supabase to send the recovery email (via requestPasswordReset). The link in
 * that email still lands on /update-password and is handled entirely by
 * RecoveryForm/updatePassword; nothing about that path changes here.
 */
export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="استعادة كلمة المرور"
      subtitle="أدخل بريدك الإلكتروني المسجَّل وسنرسل لك رابطاً لإعادة تعيين كلمة المرور"
    >
      <ForgotPasswordForm />
    </AuthShell>
  )
}
