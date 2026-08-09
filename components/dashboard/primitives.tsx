/**
 * Ranked proportion list — rank, label, count, and share of the total, with a
 * bar as a scannable secondary cue. Deliberately CSS, not a charting library:
 * the dashboard shows a handful of counts, and a 100 KB dependency to draw a
 * rectangle is not a trade worth making. The bar is decoration; the numbers
 * are the data.
 */
export function DistributionList({
  items,
  total,
  emptyLabel = 'لا توجد بيانات بعد',
  limit = 6,
}: {
  items: ReadonlyArray<{ label: string; count: number }>
  total: number
  emptyLabel?: string
  limit?: number
}) {
  if (items.length === 0) {
    return <p className="text-sm text-(--color-ink-subtle)">{emptyLabel}</p>
  }

  const shown = items.slice(0, limit)
  const max = Math.max(...shown.map((i) => i.count), 1)
  const restCount = items.length - shown.length

  return (
    <div className="space-y-4">
      <ol className="space-y-3">
        {shown.map((item, i) => {
          const share = total > 0 ? Math.round((item.count / total) * 100) : 0
          return (
            <li key={item.label} className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="shrink-0 text-xs font-medium tabular-nums text-(--color-ink-subtle)">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="truncate font-medium text-(--color-ink)">{item.label}</span>
                </span>
                <span className="flex shrink-0 items-baseline gap-1.5 tabular-nums">
                  <span className="font-semibold text-(--color-ink)">{item.count}</span>
                  <span className="text-xs text-(--color-ink-subtle)">{share}٪</span>
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-(--color-surface-sunken)" role="presentation">
                <div
                  className="h-full rounded-full bg-(--color-brand)"
                  style={{ inlineSize: `${Math.round((item.count / max) * 100)}%` }}
                />
              </div>
            </li>
          )
        })}
      </ol>
      {restCount > 0 ? (
        <p className="text-xs text-(--color-ink-subtle)">
          و{restCount} {restCount === 1 ? 'أخرى' : 'أخرى'} بعدد أقل
        </p>
      ) : null}
    </div>
  )
}

export function ErrorCard({ title, error }: { title: string; error: string }) {
  return (
    <div
      role="alert"
      className="rounded-(--radius-lg) border border-(--color-danger) bg-(--color-danger-subtle) p-5"
    >
      <h2 className="text-sm font-semibold text-(--color-danger)">{title}</h2>
      <p className="mt-1 text-sm text-(--color-ink-muted)">
        تعذّر تحميل هذا القسم. أعد المحاولة، وإن تكرر الخطأ فأبلغ مسؤول النظام.
      </p>
      <p className="mt-2 font-mono text-xs text-(--color-ink-subtle)" dir="ltr">
        {error}
      </p>
    </div>
  )
}
