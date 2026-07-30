import Link from 'next/link'

import { BarList, Card, MonthlyBars, Stat } from '@/components/dashboard/primitives'
import { CategoryBadge, CountryBadge } from '@/components/badges'
import { COUNTRIES } from '@/lib/constants/countries'
import {
  DOCUMENT_TYPE_LABELS_AR,
  LEGAL_CATEGORY_LABELS_AR,
  LEGAL_STATUS_LABELS_AR,
} from '@/lib/constants/taxonomy'
import type { LegalOverview } from '@/lib/queries/dashboard'
import { formatDateAr } from '@/lib/utils'

interface RecentUpdate {
  id: string
  title_ar: string
  country: keyof typeof COUNTRIES
  category: keyof typeof LEGAL_CATEGORY_LABELS_AR
  publication_date: string
}

/**
 * The legal picture — what every authenticated user sees regardless of role.
 *
 * Contains no operational signals: nothing about crawler health, workflow
 * failures or AI confidence appears here. Those belong to the administrative
 * section, which viewers never receive.
 */
export function LegalOverviewSection({
  overview,
  recent,
}: {
  overview: LegalOverview
  recent: readonly RecentUpdate[]
}) {
  const {
    totalUpdates,
    byCountry,
    byCategory,
    byLegalStatus,
    byDocumentType,
    overTime,
    latestPublication,
  } = overview

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="إجمالي التحديثات المنشورة" value={totalUpdates} />
        <Stat
          label="الدول التي صدر عنها تحديث"
          value={byCountry.length}
          hint={`من أصل ${Object.keys(COUNTRIES).length} نطاقات تغطية`}
        />
        <Stat
          label="أحدث تاريخ نشر"
          value={latestPublication ? formatDateAr(latestPublication) : '—'}
        />
      </div>

      <Card title="التحديثات عبر الزمن" hint="آخر اثني عشر شهراً، حسب تاريخ النشر">
        <MonthlyBars items={overTime} />
      </Card>

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

        <Card title="التحديثات حسب الحالة النظامية">
          <BarList
            items={byLegalStatus.map((b) => ({
              label: LEGAL_STATUS_LABELS_AR[b.key],
              count: b.count,
            }))}
          />
        </Card>

        <Card title="التحديثات حسب نوع الوثيقة">
          <BarList
            items={byDocumentType.map((b) => ({
              label: DOCUMENT_TYPE_LABELS_AR[b.key],
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
              <li key={item.id} className="py-3 first:pt-0 last:pb-0">
                <Link href={`/updates/${item.id}`} className="group block space-y-1.5">
                  <p className="text-sm font-medium leading-relaxed text-(--color-ink) group-hover:text-(--color-brand)">
                    {item.title_ar}
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <CountryBadge country={item.country} />
                    <CategoryBadge category={item.category} />
                    <span className="text-xs text-(--color-ink-subtle)">
                      {formatDateAr(item.publication_date)}
                    </span>
                  </div>
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
