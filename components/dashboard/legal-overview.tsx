import Link from 'next/link'

import { BarList, Card, Stat } from '@/components/dashboard/primitives'
import { CategoryBadge, CountryBadge } from '@/components/badges'
import { COUNTRIES } from '@/lib/constants/countries'
import { LEGAL_CATEGORY_LABELS_AR } from '@/lib/constants/taxonomy'
import type { LegalOverview } from '@/lib/queries/dashboard'
import { formatDateAr } from '@/lib/utils'

interface RecentUpdate {
  id: string
  title_ar: string
  summary_ar: string
  source_url: string
  country: keyof typeof COUNTRIES
  category: keyof typeof LEGAL_CATEGORY_LABELS_AR
  publication_date: string
  sources: { authority_ar: string } | null
}

export function LegalOverviewSection({
  overview,
  recent,
}: {
  overview: LegalOverview
  recent: readonly RecentUpdate[]
}) {
  const { totalUpdates, byCountry, byCategory, latestPublication } = overview

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Stat label="إجمالي التحديثات المنشورة" value={totalUpdates} />
        <Stat
          label="أحدث تاريخ نشر"
          value={latestPublication ? formatDateAr(latestPublication) : '—'}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="التحديثات حسب الدولة">
          <BarList
            items={byCountry.map((b) => ({
              label: COUNTRIES[b.key].nameAr,
              count: b.count,
            }))}
          />
        </Card>

        <Card title="التحديثات حسب التصنيف">
          <BarList
            items={byCategory.map((b) => ({
              label: LEGAL_CATEGORY_LABELS_AR[b.key],
              count: b.count,
            }))}
          />
        </Card>
      </div>

      <Card title="أحدث التحديثات">
        {recent.length === 0 ? (
          <p className="text-sm text-(--color-ink-subtle)">لم يُنشر أي تحديث بعد.</p>
        ) : (
          <ul className="divide-y divide-(--color-border)">
            {recent.map((item) => (
              <li key={item.id} className="py-4 first:pt-0 last:pb-0">
                <Link
                  href={`/updates/${item.id}`}
                  className="group block space-y-1.5"
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <CountryBadge country={item.country} />
                    <CategoryBadge category={item.category} />
                    <span className="text-xs text-(--color-ink-subtle)">
                      {formatDateAr(item.publication_date)}
                    </span>
                  </div>
                  <p className="text-sm font-medium leading-relaxed text-(--color-ink) group-hover:text-(--color-brand)">
                    {item.title_ar}
                  </p>
                  <p className="line-clamp-2 text-sm leading-relaxed text-(--color-ink-muted)">
                    {item.summary_ar}
                  </p>
                  <p className="text-xs text-(--color-ink-subtle)">
                    {item.sources?.authority_ar ?? '—'}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 border-t border-(--color-border) pt-3">
          <Link href="/updates" className="text-sm font-medium text-(--color-brand) hover:underline">
            عرض الأرشيف الكامل ←
          </Link>
        </div>
      </Card>
    </div>
  )
}
