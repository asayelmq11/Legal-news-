import { Suspense } from 'react'

import { LegalOverviewSection } from '@/components/dashboard/legal-overview'
import { ErrorCard } from '@/components/dashboard/primitives'
import { RefreshButton } from '@/components/dashboard/refresh-button'
import { requireActiveUser } from '@/lib/auth/session'
import { getLegalOverview, getRecentUpdates } from '@/lib/queries/dashboard'
import { getRefreshStatus } from '@/lib/queries/ingestion'

export const metadata = { title: 'لوحة المتابعة' }

export default async function DashboardPage() {
  const [user, refreshStatus] = await Promise.all([requireActiveUser(), getRefreshStatus()])

  return (
    <div className="space-y-10">
      <header className="space-y-3">
        <div>
          <h1 className="text-2xl font-bold text-(--color-ink)">لوحة المتابعة</h1>
          <p className="text-sm text-(--color-ink-muted)">
            أهلاً {user.full_name ?? user.email} — التحديثات القانونية الأخيرة في دول مجلس التعاون.
          </p>
        </div>
        <RefreshButton initialStatus={refreshStatus} />
      </header>

      <Suspense fallback={<SectionSkeleton rows={3} />}>
        <LegalSection />
      </Suspense>
    </div>
  )
}

async function LegalSection() {
  const [overview, recent] = await Promise.all([getLegalOverview(), getRecentUpdates(15)])

  if (!overview.ok) {
    return <ErrorCard title="تعذّر تحميل النظرة العامة" error={overview.error} />
  }

  return <LegalOverviewSection overview={overview.data} recent={recent} />
}

function SectionSkeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="جارٍ التحميل">
      <div className="grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-(--radius-card) bg-(--color-surface-sunken)"
          />
        ))}
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="h-48 animate-pulse rounded-(--radius-card) bg-(--color-surface-sunken)"
        />
      ))}
    </div>
  )
}
