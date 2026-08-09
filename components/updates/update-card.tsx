import Link from 'next/link'

import { CategoryBadge, CountryBadge } from '@/components/badges'
import type { ArchiveItem } from '@/lib/queries/updates'
import { formatDateAr } from '@/lib/utils'

/**
 * A single row in the archive. The whole card is one link target — a lawyer
 * scanning dozens of these benefits from a forgiving hit area far more than
 * from clicking a title precisely — with the title as the dominant line and
 * everything else reduced to a supporting role.
 */
export function UpdateCard({ item }: { item: ArchiveItem }) {
  return (
    <article className="group">
      <Link
        href={`/updates/${item.id}`}
        className="-mx-3 block rounded-(--radius-control) px-3 py-5 transition-colors hover:bg-(--color-surface-sunken)"
      >
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <CountryBadge country={item.country} />
          <CategoryBadge category={item.category} />
        </div>

        <h3 className="text-base font-semibold leading-relaxed text-(--color-ink) transition-colors group-hover:text-(--color-brand)">
          {item.title_ar}
        </h3>

        <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-(--color-ink-muted)">
          {item.summary_ar}
        </p>

        <p className="mt-3 text-xs text-(--color-ink-subtle)">
          <span>{item.sources?.authority_ar ?? '—'}</span>
          <span className="mx-1.5" aria-hidden="true">·</span>
          <time dateTime={item.publication_date}>{formatDateAr(item.publication_date)}</time>
        </p>
      </Link>
    </article>
  )
}
