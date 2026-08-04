import Link from 'next/link'

import { CategoryBadge, CountryBadge } from '@/components/badges'
import type { ArchiveItem } from '@/lib/queries/updates'
import { formatDateAr } from '@/lib/utils'

export function UpdateCard({ item }: { item: ArchiveItem }) {
  return (
    <article className="rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-raised) p-5 transition-colors hover:border-(--color-border-strong)">
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <CountryBadge country={item.country} />
        <CategoryBadge category={item.category} />
      </div>

      <h3 className="text-base font-semibold leading-relaxed text-(--color-ink)">
        <Link href={`/updates/${item.id}`} className="hover:text-(--color-brand)">
          {item.title_ar}
        </Link>
      </h3>

      <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-(--color-ink-muted)">
        {item.summary_ar}
      </p>

      <dl className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-(--color-ink-subtle)">
        <div className="flex gap-1">
          <dt>الجهة:</dt>
          <dd className="text-(--color-ink-muted)">{item.sources?.authority_ar ?? '—'}</dd>
        </div>
        <div className="flex gap-1">
          <dt>تاريخ النشر:</dt>
          <dd className="text-(--color-ink-muted)">{formatDateAr(item.publication_date)}</dd>
        </div>
      </dl>
    </article>
  )
}
