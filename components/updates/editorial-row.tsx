import Link from 'next/link'
import { Fragment } from 'react'

import { cn } from '@/lib/utils'

/**
 * A single editorial-feed row — the reference design's replacement for a
 * badge-per-field card: plain inline metadata above a strong title, a
 * summary, and a muted source line, separated from neighbouring rows by a
 * hairline rather than a card boundary.
 *
 * `metaSegments` is an ordered, caller-built list (content type, domain,
 * country, date — whichever apply) rather than fixed `country`/`category`/
 * `dateLabel` props: the dashboard's several sections each need a different
 * subset (a legislative-highlights row wants type+country+date; a full-feed
 * row wants type+domain+country+date; the archive's date-grouped results
 * omit date entirely, since it's the group heading instead). `null`/
 * `undefined` entries are dropped, so a caller can pass a conditional segment
 * inline without pre-filtering.
 *
 * `compact` tightens the block padding and clamps the summary to two lines —
 * used by the dashboard's feed sections, which show a handful of curated
 * items and link out to the Archive for the full text, rather than the
 * Archive's own listing which has room to breathe.
 */
export function EditorialRow({
  href,
  metaSegments,
  title,
  summary,
  sourceLabel,
  compact = false,
}: {
  href: string
  metaSegments: readonly (string | null | undefined)[]
  title: string
  summary: string
  sourceLabel: string
  compact?: boolean
}) {
  const segments = metaSegments.filter((s): s is string => Boolean(s))

  return (
    <Link
      href={href}
      className={cn(
        'group -mx-4 block space-y-2 px-4 transition-colors hover:bg-(--color-surface-sunken)',
        compact ? 'py-4' : 'py-6',
      )}
    >
      <p className="flex flex-wrap items-center gap-x-2 text-sm text-(--color-ink-muted)">
        {segments.map((segment, i) => (
          <Fragment key={i}>
            {i > 0 ? <Dot /> : null}
            <span>{segment}</span>
          </Fragment>
        ))}
      </p>

      <h3 className="text-lg font-semibold leading-snug text-(--color-ink) transition-colors group-hover:text-(--color-brand)">
        {title}
      </h3>

      <p className={cn('max-w-3xl leading-relaxed text-(--color-ink-muted)', compact && 'line-clamp-2')}>
        {summary}
      </p>

      <p className="text-xs text-(--color-ink-subtle)">{sourceLabel}</p>
    </Link>
  )
}

export function Dot() {
  return (
    <span aria-hidden="true" className="text-(--color-border-strong)">
      ·
    </span>
  )
}

export function EditorialRowList({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('divide-y divide-(--color-border)', className)}>{children}</div>
}
