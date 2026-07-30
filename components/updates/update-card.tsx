import Link from 'next/link'

import {
  CategoryBadge,
  CountryBadge,
  DocumentTypeBadge,
  LegalStatusBadge,
} from '@/components/badges'
import type { ArchiveItem } from '@/lib/queries/updates'
import { formatDateAr } from '@/lib/utils'

export function UpdateCard({ item, showConfidence }: { item: ArchiveItem; showConfidence: boolean }) {
  return (
    <article className="rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-raised) p-5 transition-colors hover:border-(--color-border-strong)">
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <CountryBadge country={item.country} />
        <CategoryBadge category={item.category} />
        <DocumentTypeBadge documentType={item.document_type} />
        <LegalStatusBadge status={item.legal_status} />
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
        {item.effective_date ? (
          <div className="flex gap-1">
            <dt>تاريخ النفاذ:</dt>
            <dd className="text-(--color-ink-muted)">{formatDateAr(item.effective_date)}</dd>
          </div>
        ) : null}
        {/*
          Confidence is administrative metadata about the classification, not
          part of the legal record. The column is not even selected for a
          viewer, so there is nothing to hide here.
        */}
        {showConfidence && item.confidence !== undefined ? (
          <div className="flex gap-1">
            <dt>الثقة:</dt>
            <dd className="font-medium text-(--color-ink-muted)">
              {(item.confidence * 100).toFixed(0)}%
            </dd>
          </div>
        ) : null}
      </dl>
    </article>
  )
}
