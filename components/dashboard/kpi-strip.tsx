import { DASHBOARD_KPI_GROUP_KEYS, DASHBOARD_KPI_GROUP_LABELS_AR } from '@/lib/constants/content-type'
import type { DocumentTypeDistribution } from '@/lib/queries/dashboard'
import { cn } from '@/lib/utils'

/**
 * The Executive Summary strip. `إجمالي المستجدات` is the one figure this
 * platform is fully sure of (every published row, classified or not) and
 * stays pinned first with the loud "primary" tile treatment. The four
 * type-based tiles are a strict partition of `document_type` (see
 * `resolveDashboardKpiGroup`) — they always sum to `distribution.classifiedTotal`,
 * shown together with `totalUpdates` in the footnote whenever the two
 * differ. A tile still hides at zero, so the strip never states a number
 * for a group this archive currently has none of — that just can't make
 * the four stop summing to the classified total, since a hidden zero
 * contributes nothing either way.
 *
 * Proportional (non-tabular) figures per the dataviz skill's stat-tile spec:
 * these are large standalone numbers, not a column needing vertical alignment.
 */
export function KpiStrip({
  totalUpdates,
  distribution,
}: {
  totalUpdates: number
  distribution: DocumentTypeDistribution
}) {
  const countOf = (key: (typeof DASHBOARD_KPI_GROUP_KEYS)[number]) =>
    distribution.buckets.find((b) => b.key === key)?.count ?? 0

  const tiles: Array<{ label: string; value: number; primary?: boolean }> = [
    { label: 'إجمالي المستجدات', value: totalUpdates, primary: true },
    ...DASHBOARD_KPI_GROUP_KEYS.map((key) => ({
      label: DASHBOARD_KPI_GROUP_LABELS_AR[key],
      value: countOf(key),
    })).filter((tile) => tile.value > 0),
  ]

  const unclassifiedCount = distribution.buckets.find((b) => b.key === 'unclassified')?.count ?? 0

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {tiles.map((tile) => (
          <div
            key={tile.label}
            className={cn(
              'rounded-(--radius-lg) border p-5',
              tile.primary
                ? 'border-(--color-brand-strong) bg-(--color-brand-strong) text-(--color-surface-raised)'
                : 'border-(--color-border) bg-(--color-surface-raised) text-(--color-ink)',
            )}
          >
            <p className={cn('text-xs font-medium', tile.primary ? 'text-white/70' : 'text-(--color-ink-subtle)')}>
              {tile.label}
            </p>
            <p className="mt-3 text-4xl font-bold [font-variant-numeric:lining-nums_proportional-nums]">
              {tile.value}
            </p>
          </div>
        ))}
      </div>
      {unclassifiedCount > 0 ? (
        <p className="text-xs text-(--color-ink-subtle)">
          المؤشرات القائمة على النوع محسوبة على {distribution.classifiedTotal} سجلاً مصنَّفاً من إجمالي{' '}
          {totalUpdates} — {unclassifiedCount} سجلاً أقدم بلا نوع مصنَّف بعد لم يُحتسب ضمنها.
        </p>
      ) : null}
    </div>
  )
}
