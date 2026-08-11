import type { ContentTypeKey } from '@/lib/constants/content-type'
import type { DocumentTypeDistribution } from '@/lib/queries/dashboard'
import { cn } from '@/lib/utils'

/**
 * The Executive Summary strip. `إجمالي المستجدات` is the one figure this
 * platform is fully sure of (every published row, classified or not) and
 * stays pinned first with the loud "primary" tile treatment; the four
 * type-based tiles are read off `distribution` — the same client-side
 * bucketing "مؤشرات حسب نوع المستجد" charts below — and a tile is only shown
 * when its count is greater than zero, so the strip never states a number
 * for a type this archive currently has none of.
 *
 * Proportional (non-tabular) figures per the dataviz skill's stat-tile spec:
 * these are large standalone numbers, not a column needing vertical alignment.
 */
const KPI_TYPE_ORDER: readonly ContentTypeKey[] = ['law', 'amendment', 'decision', 'case']

const KPI_TYPE_LABELS_AR: Readonly<Record<ContentTypeKey, string>> = {
  law: 'تشريعات جديدة',
  amendment: 'تعديلات',
  regulation: 'لوائح وأنظمة تنفيذية',
  decision: 'قرارات وتعاميم',
  case: 'قضايا وأحكام',
  other: 'أخرى',
}

export function KpiStrip({
  totalUpdates,
  distribution,
}: {
  totalUpdates: number
  distribution: DocumentTypeDistribution
}) {
  const countOf = (key: ContentTypeKey) => distribution.buckets.find((b) => b.key === key)?.count ?? 0

  const tiles: Array<{ label: string; value: number; primary?: boolean }> = [
    { label: 'إجمالي المستجدات', value: totalUpdates, primary: true },
    ...KPI_TYPE_ORDER.map((key) => ({ label: KPI_TYPE_LABELS_AR[key], value: countOf(key) })).filter(
      (tile) => tile.value > 0,
    ),
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
