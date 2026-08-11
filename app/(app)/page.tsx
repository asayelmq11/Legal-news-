import { Suspense } from 'react'

import { LegalOverviewSection } from '@/components/dashboard/legal-overview'
import { ErrorCard } from '@/components/dashboard/primitives'
import { RefreshButton } from '@/components/dashboard/refresh-button'
import { requireActiveUser } from '@/lib/auth/session'
import {
  getDocumentTypeDistribution,
  getLegalOverview,
  getRecentCases,
  getRecentUpdates,
  getTopLegislativeUpdates,
} from '@/lib/queries/dashboard'
import { getRefreshStatus } from '@/lib/queries/ingestion'

export const metadata = { title: 'لوحة المتابعة' }

export default async function DashboardPage() {
  const [user, refreshStatus] = await Promise.all([requireActiveUser(), getRefreshStatus()])

  return (
    <div className="space-y-8">
      {/* The nav's active "لوحة المتابعة" tab already announces the page, so the
          visible heading here is the welcome sentence, not a duplicate title —
          h1 stays for assistive tech/document outline without competing visually.
          Kept to a single compact row: this is status chrome, not dashboard content. */}
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <h1 className="sr-only">لوحة المتابعة</h1>
        <p className="text-sm text-(--color-ink-muted)">
          أهلاً {user.full_name ?? user.email} — التحديثات القانونية الأخيرة في دول مجلس التعاون.
        </p>
        <RefreshButton initialStatus={refreshStatus} />
      </header>

      <Suspense fallback={<SectionSkeleton rows={3} />}>
        <LegalSection />
      </Suspense>
    </div>
  )
}

async function LegalSection() {
  // Dashboard feed limits are deliberately small — this is a curated summary,
  // not the Archive. Anyone who wants the exhaustive list already has "عرض
  // الكل" / "عرض الأرشيف الكامل" links straight to the filtered Archive view.
  const [overview, distribution, topLegislative, recentCases, recent] = await Promise.all([
    getLegalOverview(),
    getDocumentTypeDistribution(),
    getTopLegislativeUpdates(6),
    getRecentCases(5),
    getRecentUpdates(8),
  ])

  if (!overview.ok) {
    return <ErrorCard title="تعذّر تحميل النظرة العامة" error={overview.error} />
  }
  if (!distribution.ok) {
    return <ErrorCard title="تعذّر تحميل مؤشرات نوع المستجد" error={distribution.error} />
  }

  return (
    <LegalOverviewSection
      overview={overview.data}
      distribution={distribution.data}
      topLegislative={topLegislative}
      recentCases={recentCases}
      recent={recent}
    />
  )
}

function SectionSkeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-12" aria-busy="true" aria-label="جارٍ التحميل">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-28 animate-pulse rounded-(--radius-lg) bg-(--color-surface-sunken)" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-56 animate-pulse rounded-(--radius-lg) bg-(--color-surface-sunken)" />
        ))}
      </div>
      <div className="space-y-3">
        {Array.from({ length: rows }, (_, i) => (
          <div
            key={i}
            className="h-16 animate-pulse rounded-(--radius-lg) bg-(--color-surface-sunken)"
          />
        ))}
      </div>
    </div>
  )
}
