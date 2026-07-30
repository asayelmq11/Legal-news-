import { Suspense } from 'react'

import { LegalOverviewSection } from '@/components/dashboard/legal-overview'
import { OperationalOverviewSection } from '@/components/dashboard/operational-overview'
import { ErrorCard } from '@/components/dashboard/primitives'
import { requireActiveUser } from '@/lib/auth/session'
import {
  getLegalOverview,
  getOperationalOverview,
  getRecentUpdates,
} from '@/lib/queries/dashboard'

export const metadata = { title: 'لوحة المتابعة' }

/**
 * Dashboard.
 *
 * Split into two independently suspended sections so the legal overview renders
 * as soon as it is ready rather than waiting on the operational queries — and
 * so a failure in one cannot blank the other.
 *
 * The operational section is not merely hidden from viewers: its query is never
 * issued for them, so the data never leaves the database.
 */
export default async function DashboardPage() {
  const user = await requireActiveUser()
  const isAdmin = user.role === 'admin'

  return (
    <div className="space-y-10">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-(--color-ink)">لوحة المتابعة</h1>
        <p className="text-sm text-(--color-ink-muted)">
          أهلاً {user.full_name ?? user.email} — نظرة عامة على الرصد القانوني الخليجي.
        </p>
      </header>

      <Suspense fallback={<SectionSkeleton rows={3} />}>
        <LegalSection />
      </Suspense>

      {isAdmin ? (
        <Suspense fallback={<SectionSkeleton rows={2} />}>
          <OperationalSection />
        </Suspense>
      ) : null}
    </div>
  )
}

async function LegalSection() {
  const [overview, recent] = await Promise.all([getLegalOverview(), getRecentUpdates(5)])

  if (!overview.ok) {
    return <ErrorCard title="تعذّر تحميل النظرة العامة" error={overview.error} />
  }

  return <LegalOverviewSection overview={overview.data} recent={recent} />
}

async function OperationalSection() {
  const result = await getOperationalOverview()

  if (!result.ok) {
    return <ErrorCard title="تعذّر تحميل المؤشرات التشغيلية" error={result.error} />
  }

  return <OperationalOverviewSection data={result.data} />
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
