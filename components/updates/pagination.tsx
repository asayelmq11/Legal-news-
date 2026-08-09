import Link from 'next/link'

import { ChevronIcon } from '@/components/icons'
import { buildArchiveQuery, MAX_PAGE, type ArchiveFilters } from '@/lib/updates/filters'
import { cn } from '@/lib/utils'

/**
 * Pagination as links, not buttons — each page is a real URL, so it can be
 * bookmarked, opened in a new tab, and reached by the back button. Prev/next
 * plus a window around the current page keeps the control usable on an archive
 * that will grow to thousands of entries.
 */
export function ArchivePagination({
  filters,
  page,
  pageCount,
  total,
}: {
  filters: ArchiveFilters
  page: number
  pageCount: number
  total: number
}) {
  if (pageCount <= 1) return null

  const windowSize = 2
  const start = Math.max(1, page - windowSize)
  const end = Math.min(pageCount, page + windowSize)
  const pages = Array.from({ length: end - start + 1 }, (_, i) => start + i)

  const atCap = pageCount > MAX_PAGE

  return (
    <nav aria-label="ترقيم الصفحات" className="flex flex-col items-center gap-3 border-t border-(--color-border) pt-6">
      <ul className="flex flex-wrap items-center justify-center gap-1">
        <PageLink filters={filters} to={page - 1} disabled={page <= 1} label="السابق" icon="prev" />

        {start > 1 ? (
          <>
            <PageLink filters={filters} to={1} label="1" />
            {start > 2 ? <li className="px-1 text-(--color-ink-subtle)">…</li> : null}
          </>
        ) : null}

        {pages.map((p) => (
          <PageLink key={p} filters={filters} to={p} label={String(p)} current={p === page} />
        ))}

        {end < pageCount ? (
          <>
            {end < pageCount - 1 ? <li className="px-1 text-(--color-ink-subtle)">…</li> : null}
            <PageLink filters={filters} to={pageCount} label={String(pageCount)} />
          </>
        ) : null}

        <PageLink
          filters={filters}
          to={page + 1}
          disabled={page >= pageCount}
          label="التالي"
          icon="next"
        />
      </ul>

      <p className="text-xs text-(--color-ink-subtle)">
        صفحة <span className="font-medium text-(--color-ink-muted)">{page}</span> من {pageCount} ·{' '}
        {total} تحديث
      </p>

      {atCap ? (
        <p className="text-xs text-(--color-warn)">
          يقتصر التصفح على {MAX_PAGE} صفحة. استخدم البحث أو عوامل التصفية للوصول إلى نتائج أقدم.
        </p>
      ) : null}
    </nav>
  )
}

function PageLink({
  filters,
  to,
  label,
  current = false,
  disabled = false,
  icon,
}: {
  filters: ArchiveFilters
  to: number
  label: string
  current?: boolean
  disabled?: boolean
  icon?: 'prev' | 'next'
}) {
  const base = 'flex h-9 min-w-9 items-center justify-center gap-1 rounded-(--radius-control) px-3 text-sm font-medium'

  const content = (
    <>
      {icon === 'prev' ? <ChevronIcon className="size-3.5 rotate-180" /> : null}
      {label}
      {icon === 'next' ? <ChevronIcon className="size-3.5" /> : null}
    </>
  )

  if (disabled) {
    return (
      <li>
        <span className={cn(base, 'cursor-not-allowed text-(--color-ink-subtle) opacity-50')}>
          {content}
        </span>
      </li>
    )
  }

  return (
    <li>
      <Link
        href={`/updates${buildArchiveQuery(filters, { page: to })}`}
        aria-current={current ? 'page' : undefined}
        className={cn(
          base,
          'transition-colors',
          current
            ? 'bg-(--color-brand) text-white'
            : 'text-(--color-ink-muted) hover:bg-(--color-surface-sunken) hover:text-(--color-ink)',
        )}
      >
        {content}
      </Link>
    </li>
  )
}
