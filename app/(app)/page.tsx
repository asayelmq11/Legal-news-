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
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4 border-b border-(--color-border) pb-6">
        <div>
          <h1 className="text-2xl font-bold text-(--color-ink)">لوحة المتابعة</h1>
          <p className="mt-1 text-sm text-(--color-ink-muted)">
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
    <div className="space-y-10" aria-busy="true" aria-label="جارٍ التحميل">
      <div className="h-28 animate-pulse rounded-(--radius-lg) bg-(--color-surface-sunken)" />
      <div className="grid gap-8 lg:grid-cols-2">
        {[0, 1].map((i) => (
          <div
            key={i}
            className="h-48 animate-pulse rounded-(--radius-lg) bg-(--color-surface-sunken)"
          />
        ))}
      </div>
      <div className="space-y-3">
        {Array.from({ length: rows }, (_, i) => (
          <div
            key={i}
            className="h-20 animate-pulse rounded-(--radius-lg) bg-(--color-surface-sunken)"
          />
        ))}
      </div>
    </div>
  )
}
