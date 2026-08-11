import Link from 'next/link'

import { KpiStrip } from '@/components/dashboard/kpi-strip'
import { DistributionList } from '@/components/dashboard/primitives'
import { ChevronIcon } from '@/components/icons'
import { EditorialRow, EditorialRowList } from '@/components/updates/editorial-row'
import {
  CONTENT_TYPE_LABELS_AR,
  contentTypeLabel,
  resolveContentType,
  type ContentTypeKey,
} from '@/lib/constants/content-type'
import { COUNTRIES } from '@/lib/constants/countries'
import { DOCUMENT_TYPE_LABELS_AR, LEGAL_CATEGORY_LABELS_AR, LEGAL_STATUS_LABELS_AR } from '@/lib/constants/taxonomy'
import type { DashboardUpdateRow, DocumentTypeDistribution, LegalOverview } from '@/lib/queries/dashboard'
import { formatDateAr, relativeDayAr } from '@/lib/utils'

/** Fixed presentation order for "أهم المستجدات التشريعية والتنظيمية" — cases and the residual "other" bucket have their own sections and never appear here. */
const LEGISLATIVE_GROUP_ORDER: readonly ContentTypeKey[] = ['law', 'amendment', 'regulation', 'decision']

function dateLabelFor(item: { publication_date: string }) {
  return relativeDayAr(item.publication_date) ?? formatDateAr(item.publication_date)
}

function groupLegislativeUpdates(items: readonly DashboardUpdateRow[]) {
  const groups = new Map<ContentTypeKey, DashboardUpdateRow[]>()
  for (const item of items) {
    const bucket = resolveContentType(item)
    if (bucket === 'unclassified' || !LEGISLATIVE_GROUP_ORDER.includes(bucket)) continue
    const existing = groups.get(bucket)
    if (existing) existing.push(item)
    else groups.set(bucket, [item])
  }
  return LEGISLATIVE_GROUP_ORDER.map((key) => ({ key, items: groups.get(key) ?? [] })).filter(
    (group) => group.items.length > 0,
  )
}

function caseTypeLabel(item: DashboardUpdateRow): string {
  return item.document_type === 'court_precedent' ? DOCUMENT_TYPE_LABELS_AR.court_precedent : 'قضية جارية'
}

export function LegalOverviewSection({
  overview,
  distribution,
  topLegislative,
  recentCases,
  recent,
}: {
  overview: LegalOverview
  distribution: DocumentTypeDistribution
  topLegislative: readonly DashboardUpdateRow[]
  recentCases: readonly DashboardUpdateRow[]
  recent: readonly DashboardUpdateRow[]
}) {
  // GCC is a real `country` value (the Secretariat's own content) and stays
  // fully in the data/query layer — it's still searchable, still shown on an
  // individual article's own country line. It's excluded only from this one
  // chart's bars, the same presentation-only carve-out already applied to
  // the archive's country filter (see archive-filters.tsx).
  const byCountry = overview.byCountry.filter((b) => b.key !== 'GCC')
  const legislativeGroups = groupLegislativeUpdates(topLegislative)

  return (
    <div className="space-y-12">
      {/* 1. المؤشرات التنفيذية — the page's first and only "loud" element. */}
      <KpiStrip totalUpdates={overview.totalUpdates} distribution={distribution} />

      {/* 2. التحليلات — every chart lives here, together, immediately after the
          KPIs and before any content feed. Type-based counts already live in
          the KPI cards above (KpiStrip), so this group only covers what those
          cards don't: geography and legal domain. */}
      <section className="space-y-4">
        <p className="text-sm font-semibold text-(--color-ink-subtle)">التحليلات</p>
        <div className="grid gap-6 lg:grid-cols-2">
          {/* DOM order intentionally puts the country panel first: in this RTL
              grid the first child lands in the rightmost column. */}
          <div className="space-y-4 rounded-(--radius-lg) border border-(--color-border) p-6">
            <SectionHeader
              title="النشاط القانوني حسب الدولة"
              hint={`من إجمالي ${overview.totalUpdates}`}
            />
            <DistributionList
              items={byCountry.map((b) => ({ label: COUNTRIES[b.key].nameAr, count: b.count }))}
              total={overview.totalUpdates}
            />
          </div>

          <div className="space-y-4 rounded-(--radius-lg) border border-(--color-border) p-6">
            <SectionHeader
              title="التوزيع حسب المجال القانوني"
              hint={`من إجمالي ${overview.totalUpdates}`}
            />
            <DistributionList
              items={overview.byCategory.map((b) => ({ label: LEGAL_CATEGORY_LABELS_AR[b.key], count: b.count }))}
              total={overview.totalUpdates}
            />
          </div>
        </div>
      </section>

      {/* 3. أهم المستجدات التشريعية والتنظيمية — the primary content feed. Its
          type-grouping (a small brand-colored label per bucket) is what makes
          it read as structured/curated rather than a plain list, which is
          what sets it apart from the two flatter feeds below. */}
      <section className="space-y-5">
        <SectionHeader
          title="أهم المستجدات التشريعية والتنظيمية"
          hint="أحدث التشريعات والتعديلات واللوائح والقرارات، مصنّفة حسب نوعها"
        />
        {legislativeGroups.length === 0 ? (
          <p className="text-sm text-(--color-ink-subtle)">لا توجد مستجدات تشريعية مصنّفة بعد.</p>
        ) : (
          <div className="space-y-6">
            {legislativeGroups.map((group) => (
              <div key={group.key} className="space-y-1">
                <h3 className="border-b border-(--color-border) pb-2 text-sm font-semibold text-(--color-brand)">
                  {CONTENT_TYPE_LABELS_AR[group.key]}
                </h3>
                <EditorialRowList>
                  {group.items.map((item) => (
                    <EditorialRow
                      key={item.id}
                      href={`/updates/${item.id}`}
                      compact
                      metaSegments={[
                        COUNTRIES[item.country].nameAr,
                        item.legal_status ? LEGAL_STATUS_LABELS_AR[item.legal_status] : null,
                        dateLabelFor(item),
                      ]}
                      title={item.title_ar}
                      summary={item.summary_ar}
                      sourceLabel={item.sources?.authority_ar ?? '—'}
                    />
                  ))}
                </EditorialRowList>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 4. آخر القضايا والأحكام — a lighter, secondary treatment: a flat list
          with no type sub-headers, so it never competes with section 3 above. */}
      <section className="space-y-1">
        <div className="flex items-center justify-between gap-3 border-b border-(--color-border) pb-3">
          <SectionHeader title="آخر القضايا والأحكام" hint="قضايا وأحكام قضائية بارزة ذات قيمة قانونية" />
          <Link
            href="/updates?contentType=case"
            className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-(--color-brand) hover:underline"
          >
            عرض الكل
            <ChevronIcon className="size-3.5" />
          </Link>
        </div>

        {recentCases.length === 0 ? (
          <p className="py-6 text-sm text-(--color-ink-subtle)">لا توجد قضايا مرصودة بعد.</p>
        ) : (
          <EditorialRowList>
            {recentCases.map((item) => (
              <EditorialRow
                key={item.id}
                href={`/updates/${item.id}`}
                compact
                metaSegments={[COUNTRIES[item.country].nameAr, caseTypeLabel(item), dateLabelFor(item)]}
                title={item.title_ar}
                summary={item.summary_ar}
                sourceLabel={item.sources?.authority_ar ?? '—'}
              />
            ))}
          </EditorialRowList>
        )}
      </section>

      {/* 5. أحدث المحتوى القانوني الكامل — the catch-all, last on purpose: every
          section above already curated the important intelligence, this is
          just the tail of the same feed the Archive browses exhaustively. */}
      <section className="space-y-1">
        <div className="flex items-center justify-between gap-3 border-b border-(--color-border) pb-3">
          <SectionHeader title="أحدث المحتوى القانوني الكامل" hint="كل ما رُصد في الأرشيف، بحسب تاريخ النشر" />
          <Link
            href="/updates"
            className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-(--color-brand) hover:underline"
          >
            عرض الأرشيف الكامل
            <ChevronIcon className="size-3.5" />
          </Link>
        </div>

        {recent.length === 0 ? (
          <p className="py-6 text-sm text-(--color-ink-subtle)">لم يُنشر أي تحديث بعد.</p>
        ) : (
          <EditorialRowList>
            {recent.map((item) => (
              <EditorialRow
                key={item.id}
                href={`/updates/${item.id}`}
                compact
                metaSegments={[
                  contentTypeLabel(item),
                  LEGAL_CATEGORY_LABELS_AR[item.category],
                  COUNTRIES[item.country].nameAr,
                  dateLabelFor(item),
                ]}
                title={item.title_ar}
                summary={item.summary_ar}
                sourceLabel={item.sources?.authority_ar ?? '—'}
              />
            ))}
          </EditorialRowList>
        )}
      </section>
    </div>
  )
}

function SectionHeader({ title, hint }: { title: string; hint: string }) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-(--color-ink)">{title}</h2>
      <p className="mt-0.5 text-sm text-(--color-ink-subtle)">{hint}</p>
    </div>
  )
}
