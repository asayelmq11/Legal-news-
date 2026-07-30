import { cn } from '@/lib/utils'

export function Card({
  title,
  hint,
  children,
  className,
}: {
  title: string
  hint?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <section
      className={cn(
        'rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-raised) p-5',
        className,
      )}
    >
      <header className="mb-4">
        <h2 className="text-sm font-semibold text-(--color-ink)">{title}</h2>
        {hint ? <p className="mt-0.5 text-xs text-(--color-ink-subtle)">{hint}</p> : null}
      </header>
      {children}
    </section>
  )
}

export function Stat({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string
  value: string | number
  // Explicit `| undefined` because exactOptionalPropertyTypes distinguishes
  // "absent" from "present and undefined", and callers pass a computed value.
  hint?: string | undefined
  tone?: 'neutral' | 'ok' | 'warn' | 'danger'
}) {
  const toneClass = {
    neutral: 'text-(--color-ink)',
    ok: 'text-(--color-ok)',
    warn: 'text-(--color-warn)',
    danger: 'text-(--color-danger)',
  }[tone]

  return (
    <div className="rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-raised) px-5 py-4">
      <p className="text-sm text-(--color-ink-muted)">{label}</p>
      <p className={cn('mt-1 text-2xl font-bold tabular-nums', toneClass)}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-(--color-ink-subtle)">{hint}</p> : null}
    </div>
  )
}

/**
 * Horizontal proportion bars.
 *
 * Deliberately CSS, not a charting library: the dashboard shows a handful of
 * category counts, and a 100 KB dependency to draw a rectangle is not a trade
 * worth making in a platform whose stated priority is maintainability. Values
 * are rendered as text alongside the bar, so the bar is decoration and the
 * number is the data.
 */
export function BarList({
  items,
  emptyLabel = 'لا توجد بيانات بعد',
}: {
  items: ReadonlyArray<{ label: string; count: number }>
  emptyLabel?: string
}) {
  if (items.length === 0) {
    return <p className="text-sm text-(--color-ink-subtle)">{emptyLabel}</p>
  }

  const max = Math.max(...items.map((i) => i.count), 1)

  return (
    <ul className="space-y-2.5">
      {items.map((item) => (
        <li key={item.label} className="space-y-1">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="text-(--color-ink-muted)">{item.label}</span>
            <span className="font-semibold tabular-nums text-(--color-ink)">{item.count}</span>
          </div>
          <div
            className="h-1.5 overflow-hidden rounded-full bg-(--color-surface-sunken)"
            role="presentation"
          >
            <div
              className="h-full rounded-full bg-(--color-brand)"
              style={{ inlineSize: `${Math.round((item.count / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}

/** Sparkline-style monthly column chart, again in plain CSS. */
export function MonthlyBars({
  items,
  emptyLabel = 'لا توجد بيانات بعد',
}: {
  items: ReadonlyArray<{ month: string; count: number }>
  emptyLabel?: string
}) {
  const total = items.reduce((sum, i) => sum + i.count, 0)
  if (total === 0) {
    return <p className="text-sm text-(--color-ink-subtle)">{emptyLabel}</p>
  }

  const max = Math.max(...items.map((i) => i.count), 1)
  const monthLabel = new Intl.DateTimeFormat('ar', { month: 'short', timeZone: 'UTC' })

  return (
    <ol className="flex items-end justify-between gap-1" style={{ blockSize: '8rem' }}>
      {items.map((item) => {
        const heightPct = Math.max(2, Math.round((item.count / max) * 100))
        const label = monthLabel.format(new Date(`${item.month}T00:00:00Z`))
        return (
          <li key={item.month} className="flex flex-1 flex-col items-center justify-end gap-1">
            <span className="text-xs tabular-nums text-(--color-ink-subtle)">
              {item.count > 0 ? item.count : ''}
            </span>
            <div
              className="w-full rounded-t bg-(--color-brand)"
              style={{ blockSize: `${heightPct}%` }}
              title={`${label}: ${item.count}`}
            />
            <span className="text-[0.65rem] text-(--color-ink-subtle)">{label}</span>
          </li>
        )
      })}
    </ol>
  )
}

export function ErrorCard({ title, error }: { title: string; error: string }) {
  return (
    <div
      role="alert"
      className="rounded-(--radius-card) border border-(--color-danger) bg-(--color-danger-subtle) p-5"
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
