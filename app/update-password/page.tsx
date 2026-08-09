import type { Metadata } from 'next'

import { AuthShell } from '@/components/ui'
import { RecoveryForm } from './recovery-form'

export const metadata: Metadata = { title: 'تعيين كلمة مرور جديدة' }

/**
 * Where a Supabase recovery link lands.
 *
 * Public by necessity: the link arrives with no cookies at all — the session is
 * in the URL fragment, which never reaches the server — so the proxy has to let
 * the request through for the client to be able to exchange it. See
 * PUBLIC_PATHS in lib/supabase/proxy.ts.
 *
 * Nothing is read from the URL on the server. This component is deliberately
 * inert; all of the work happens in RecoveryForm, in the browser, because that
 * is the only place a fragment exists.
 */
export default function UpdatePasswordPage() {
  return (
    <AuthShell
      title="تعيين كلمة مرور جديدة"
      subtitle="اختر كلمة مرور جديدة لحسابك في منصة الرصد القانوني"
    >
      <RecoveryForm />
    </AuthShell>
  )
}
