import Link from 'next/link'

import { cn } from '@/lib/utils'

/**
 * Shared full-page state. Every one of these screens tells the user what
 * happened, why, and who can resolve it — a dead end with no next step is a
 * support ticket waiting to happen.
 */
export function StatusScreen({
  tone = 'neutral',
  title,
  body,
  action,
  detail,
}: {
  tone?: 'neutral' | 'warn' | 'danger'
  title: string
  body: string
  action?: { href: string; label: string }
  detail?: React.ReactNode
}) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-6 py-16">
      <div
        className={cn(
          'space-y-4 rounded-(--radius-card) border p-8',
          tone === 'danger' && 'border-(--color-danger) bg-(--color-danger-subtle)',
          tone === 'warn' && 'border-(--color-warn) bg-(--color-warn-subtle)',
          tone === 'neutral' && 'border-(--color-border) bg-(--color-surface-raised)',
        )}
      >
        <h1 className="text-lg font-bold text-(--color-ink)">{title}</h1>
        <p className="text-sm leading-relaxed text-(--color-ink-muted)">{body}</p>

        {detail ? <div className="text-sm text-(--color-ink-muted)">{detail}</div> : null}

        {action ? (
          <Link
            href={action.href}
            className="inline-block rounded-md bg-(--color-brand) px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-(--color-brand-hover)"
          >
            {action.label}
          </Link>
        ) : null}
      </div>
    </main>
  )
}
