import Link from 'next/link'

import { XIcon } from '@/components/icons'
import { COUNTRIES } from '@/lib/constants/countries'
import { LEGAL_CATEGORY_LABELS_AR } from '@/lib/constants/taxonomy'
import { listFilterSources } from '@/lib/queries/updates'
import { buildArchiveQuery, hasActiveFilters, type ArchiveFilters } from '@/lib/updates/filters'
import { formatDateAr } from '@/lib/utils'

/**
 * A scannable summary of what's currently narrowing the archive, each chip
 * removable on its own. Every chip's href is built by `buildArchiveQuery` on a
 * copy of the same parsed `filters` object the results query already used —
 * "remove one filter" always reproduces exactly the URL the filter form
 * itself would have produced, never a hand-built query string.
 */
export async function ActiveFilterChips({ filters }: { filters: ArchiveFilters }) {
  if (!hasActiveFilters(filters)) return null

  const chips: { key: string; label: string; href: string }[] = []

  if (filters.q) {
    chips.push({
      key: 'q',
      label: `البحث: «${filters.q}»`,
      href: `/updates${buildArchiveQuery({ ...filters, q: '', page: 1 })}`,
    })
  }

  for (const c of filters.country) {
    chips.push({
      key: `country-${c}`,
      label: COUNTRIES[c].nameAr,
      href: `/updates${buildArchiveQuery({
        ...filters,
        country: filters.country.filter((x) => x !== c),
        page: 1,
      })}`,
    })
  }

  for (const c of filters.category) {
    chips.push({
      key: `category-${c}`,
      label: LEGAL_CATEGORY_LABELS_AR[c],
      href: `/updates${buildArchiveQuery({
        ...filters,
        category: filters.category.filter((x) => x !== c),
        page: 1,
      })}`,
    })
  }

  if (filters.source) {
    const sources = await listFilterSources()
    const source = sources.find((s) => s.id === filters.source)
    chips.push({
      key: 'source',
      label: source ? source.authority_ar : 'مصدر محدد',
      href: `/updates${buildArchiveQuery({ ...filters, source: undefined, page: 1 })}`,
    })
  }

  if (filters.publishedFrom || filters.publishedTo) {
    const from = filters.publishedFrom ? formatDateAr(filters.publishedFrom) : '—'
    const to = filters.publishedTo ? formatDateAr(filters.publishedTo) : '—'
    chips.push({
      key: 'date',
      label: `التاريخ: ${from} – ${to}`,
      href: `/updates${buildArchiveQuery({
        ...filters,
        publishedFrom: undefined,
        publishedTo: undefined,
        page: 1,
      })}`,
    })
  }

  return (
    <ul className="flex flex-wrap items-center gap-2">
      {chips.map((chip) => (
        <li key={chip.key}>
          <Link
            href={chip.href}
            className="inline-flex items-center gap-1.5 rounded-full bg-(--color-brand-subtle) py-1 ps-3 pe-2 text-xs font-medium text-(--color-brand) transition-colors hover:bg-(--color-border-strong)/30"
          >
            {chip.label}
            <XIcon className="size-3" />
          </Link>
        </li>
      ))}
    </ul>
  )
}
