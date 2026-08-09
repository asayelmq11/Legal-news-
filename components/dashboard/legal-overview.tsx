import Link from 'next/link'

import { DistributionList } from '@/components/dashboard/primitives'
import { CategoryBadge, CountryBadge } from '@/components/badges'
import { ChevronIcon } from '@/components/icons'
import { COUNTRIES, COUNTRY_CODES } from '@/lib/constants/countries'
import { LEGAL_CATEGORIES, LEGAL_CATEGORY_LABELS_AR } from '@/lib/constants/taxonomy'
import type { LegalOverview } from '@/lib/queries/dashboard'
import { formatDateAr, relativeDayAr } from '@/lib/utils'

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

  const topCountry = byCountry[0]
  const topCategory = byCategory[0]

  const heroCaption =
    byCountry.length > 0
      ? `عبر ${byCountry.length} من ${COUNTRY_CODES.length} دول مشمولة بالرصد، و${byCategory.length} من ${LEGAL_CATEGORIES.length} تصنيفاً قانونياً.`
      : undefined

  const indicators = [
    { label: 'أحدث تاريخ نشر', value: latestPublication ? formatDateAr(latestPublication) : '—' },
    {
      label: 'الدولة الأكثر نشاطاً',
      value: topCountry ? COUNTRIES[topCountry.key].nameAr : '—',
    },
    {
      label: 'التصنيف الأكثر نشاطاً',
      value: topCategory ? LEGAL_CATEGORY_LABELS_AR[topCategory.key] : '—',
    },
  ]

  return (
    <div className="space-y-8">
      <div className="pb-2">
        <p className="text-sm font-medium text-(--color-ink-muted)">إجمالي التحديثات المرصودة</p>
        <p className="mt-3 text-7xl font-bold tracking-tight tabular-nums text-(--color-ink) sm:text-8xl">
          {totalUpdates}
        </p>
        {heroCaption ? (
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-(--color-ink-subtle)">{heroCaption}</p>
        ) : null}

        <div className="mt-8 flex flex-wrap items-baseline gap-x-10 gap-y-3">
          {indicators.map((item) => (
            <div key={item.label} className="flex items-baseline gap-2 text-sm">
              <span className="text-(--color-ink-subtle)">{item.label}</span>
              <span className="font-semibold text-(--color-ink)">{item.value}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="h-px bg-(--color-border)" />

      <div className="grid gap-8 lg:grid-cols-2">
        <section className="space-y-4">
          <SectionHeading title="الدول الأكثر نشاطاً" hint="نسبة كل دولة من إجمالي التحديثات المرصودة" />
          <DistributionList
            items={byCountry.map((b) => ({ label: COUNTRIES[b.key].nameAr, count: b.count }))}
            total={totalUpdates}
          />
        </section>

        <section className="space-y-4">
          <SectionHeading title="التصنيفات الأكثر نشاطاً" hint="أبرز المجالات القانونية المرصودة" />
          <DistributionList
            items={byCategory.map((b) => ({ label: LEGAL_CATEGORY_LABELS_AR[b.key], count: b.count }))}
            total={totalUpdates}
          />
        </section>
      </div>

      <div className="h-px bg-(--color-border)" />

      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <SectionHeading title="أحدث التحديثات" hint="آخر ما رُصد في الأرشيف، بحسب تاريخ النشر" />
          <Link
            href="/updates"
            className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-(--color-brand) hover:underline"
          >
            الأرشيف الكامل
            <ChevronIcon className="size-3.5" />
          </Link>
        </div>

        {recent.length === 0 ? (
          <p className="text-sm text-(--color-ink-subtle)">لم يُنشر أي تحديث بعد.</p>
        ) : (
          <ul className="divide-y divide-(--color-border)">
            {recent.map((item) => {
              const relativeDay = relativeDayAr(item.publication_date)
              return (
                <li key={item.id}>
                  <Link
                    href={`/updates/${item.id}`}
                    className="group -mx-3 block space-y-1.5 rounded-(--radius-control) px-3 py-4 transition-colors hover:bg-(--color-surface-sunken)"
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <CountryBadge country={item.country} />
                      <CategoryBadge category={item.category} />
                      <span className="text-xs text-(--color-ink-subtle)">
                        {relativeDay ?? formatDateAr(item.publication_date)}
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
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

function SectionHeading({ title, hint }: { title: string; hint: string }) {
  return (
    <div>
      <h2 className="text-xs font-semibold tracking-wide text-(--color-ink-subtle)">{title}</h2>
      <p className="mt-0.5 text-xs text-(--color-ink-subtle)">{hint}</p>
    </div>
  )
}
