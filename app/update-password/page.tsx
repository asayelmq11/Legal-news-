import type { Metadata } from 'next'

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
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-16">
      <div className="space-y-6 rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-raised) p-8">
        <header className="space-y-2 text-center">
          <h1 className="text-xl font-bold text-(--color-ink)">تعيين كلمة مرور جديدة</h1>
          <p className="text-sm text-(--color-ink-muted)">
            اختر كلمة مرور جديدة لحسابك في منصة الرصد القانوني
          </p>
        </header>

        <RecoveryForm />
      </div>
    </main>
  )
}
