import { AppNav } from '@/components/app-nav'
import { SignOutButton } from '@/components/sign-out-button'
import { requireActiveUser } from '@/lib/auth/session'
import { navItemsFor } from '@/lib/nav'
import { USER_ROLE_LABELS_AR } from '@/lib/constants/taxonomy'

/**
 * The authenticated shell — and the application's authentication boundary.
 *
 * requireActiveUser() runs here, so every route in this group is guarded
 * without each page needing to remember. The proxy only refreshes the session
 * and does a coarse redirect; this is the check that counts, and beneath it
 * Postgres RLS is the check that cannot be bypassed at all.
 */
export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await requireActiveUser()
  const items = navItemsFor(user.role)

  return (
    <div className="min-h-dvh">
      <header className="border-b border-(--color-border) bg-(--color-surface-raised)">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-3">
          <div className="flex items-center gap-6">
            <span className="text-sm font-bold text-(--color-ink)">منصة الرصد القانوني</span>
            <AppNav items={items} />
          </div>

          <div className="flex items-center gap-3">
            <span className="text-sm text-(--color-ink-muted)">
              {user.full_name ?? user.email}
              <span className="mx-1.5 text-(--color-ink-subtle)">·</span>
              <span className="text-(--color-ink-subtle)">{USER_ROLE_LABELS_AR[user.role]}</span>
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  )
}
