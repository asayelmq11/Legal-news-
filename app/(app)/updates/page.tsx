import { Suspense } from 'react'

import { ArchiveFilterPanel } from '@/components/updates/archive-filters'
import { ArchivePagination } from '@/components/updates/pagination'
import { UpdateCard } from '@/components/updates/update-card'
import { requireActiveUser } from '@/lib/auth/session'
import {
  groupByPublicationDate,
  listArchive,
  listFilterSources,
} from '@/lib/queries/updates'
import {
  hasActiveFilters,
  parseArchiveFilters,
  type RawSearchParams,
} from '@/lib/updates/filters'
import { formatDateAr } from '@/lib/utils'

export const metadata = { title: 'الأرشيف القانوني' }

export default async function UpdatesPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>
}) {
  const user = await requireActiveUser()
  const raw = await searchParams
  const isAdmin = user.role === 'admin'
  const filters = parseArchiveFilters(raw)

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-(--color-ink)">الأرشيف القانوني</h1>
        <p className="text-sm text-(--color-ink-muted)">
          التحديثات القانونية والتنظيمية الصادرة عن الجهات الرسمية المعتمدة في دول مجلس التعاون.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <aside>
          <Suspense fallback={<FilterSkeleton />}>
            <FilterPanel />
          </Suspense>
        </aside>

        <section>
          {/*
            Keyed on the serialised filters so changing any of them remounts the
            boundary and the skeleton is shown again, rather than the previous
            result set sitting there looking current while the new query runs.
          */}
          <Suspense key={JSON.stringify(filters)} fallback={<ResultsSkeleton />}>
            <Results filters={filters} isAdmin={isAdmin} />
          </Suspense>
        </section>
      </div>
    </div>
  )
}

async function FilterPanel() {
  const sources = await listFilterSources()
  return <ArchiveFilterPanel sources={sources} />
}

async function Results({
  filters,
  isAdmin,
}: {
  filters: ReturnType<typeof parseArchiveFilters>
  isAdmin: boolean
}) {
  const result = await listArchive(filters, { isAdmin })

  if (!result.ok) {
    return (
      <div
        role="alert"
        className="rounded-(--radius-card) border border-(--color-danger) bg-(--color-danger-subtle) p-6"
      >
        <h2 className="text-sm font-semibold text-(--color-danger)">تعذّر تحميل الأرشيف</h2>
        <p className="mt-1 text-sm text-(--color-ink-muted)">
          حدث خطأ أثناء الاستعلام. أعد المحاولة، وإن تكرر الخطأ فأبلغ مسؤول النظام.
        </p>
        <p className="mt-2 font-mono text-xs text-(--color-ink-subtle)" dir="ltr">
          {result.error}
        </p>
      </div>
    )
  }

  const { items, total, page, pageCount, usedFuzzyFallback } = result.data
  const filtered = hasActiveFilters(filters)

  if (items.length === 0) {
    return <EmptyState filtered={filtered} query={filters.q} />
  }

  const groups = groupByPublicationDate(items)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm text-(--color-ink-muted)">
          {total} نتيجة{filtered ? ' مطابقة للتصفية' : ''}
        </p>
        {usedFuzzyFallback ? (
          <p className="rounded-md bg-(--color-warn-subtle) px-3 py-1 text-xs text-(--color-warn)">
            لا توجد مطابقات تامة — عُرضت نتائج تقريبية.
          </p>
        ) : null}
      </div>

      {/* Timeline: grouped by publication date, one group per distinct date on
          this page. Ordering and pagination stay in Postgres. */}
      <ol className="space-y-8">
        {groups.map((group) => (
          <li key={group.date} className="space-y-3">
            <h2 className="sticky top-0 z-10 -mx-1 bg-(--color-surface)/95 px-1 py-1 text-sm font-semibold text-(--color-ink-muted) backdrop-blur">
              <time dateTime={group.date}>{formatDateAr(group.date)}</time>
            </h2>
            <ul className="space-y-3">
              {group.items.map((item) => (
                <li key={item.id}>
                  <UpdateCard item={item} />
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>

      <ArchivePagination
        filters={filters}
        page={page}
        pageCount={pageCount}
        total={total}
      />
    </div>
  )
}

function EmptyState({ filtered, query }: { filtered: boolean; query: string }) {
  return (
    <div className="rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-raised) p-8 text-center">
      <h2 className="text-sm font-semibold text-(--color-ink)">
        {filtered ? 'لا توجد نتائج مطابقة' : 'الأرشيف فارغ حتى الآن'}
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-(--color-ink-muted)">
        {filtered ? (
          <>
            {query ? (
              <>
                لم يُعثر على تحديثات تطابق «{query}»
                {' '}مع عوامل التصفية الحالية. جرّب توسيع النطاق الزمني أو إزالة بعض عوامل التصفية.
              </>
            ) : (
              'لم يُعثر على تحديثات تطابق عوامل التصفية الحالية. جرّب توسيع النطاق الزمني أو إزالة بعض العوامل.'
            )}
          </>
        ) : (
          'لم يُنشر أي تحديث بعد. يبدأ الرصد بعد التحقق من إمكانية الوصول لكل مصدر من بيئة التشغيل وتفعيله.'
        )}
      </p>
    </div>
  )
}

function FilterSkeleton() {
  return (
    <div
      aria-hidden
      className="h-[32rem] animate-pulse rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-sunken)"
    />
  )
}

function ResultsSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="جارٍ التحميل">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="h-36 animate-pulse rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-sunken)"
        />
      ))}
    </div>
  )
}
