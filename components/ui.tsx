import Link from 'next/link'

import { ChevronIcon, ScaleIcon } from '@/components/icons'
import { cn } from '@/lib/utils'

/**
 * Shared presentational tokens for form controls and buttons.
 *
 * A handful of screens (login, the archive filters, the admin forms) each
 * used to hand-roll their own input/button class strings, which drifted out
 * of sync — a different height here, a missing focus ring there. Centralising
 * them means "what does a text input look like" has exactly one answer.
 * These are class strings, not components, so every call site keeps full
 * control over the element it renders (native <select>, <textarea>, a Link
 * styled as a button, a Server Action <button>) and nothing here touches
 * behaviour.
 */

export const CONTROL =
  'h-10 w-full rounded-(--radius-control) border border-(--color-border-strong) bg-(--color-surface) px-3 text-sm text-(--color-ink) outline-none transition-colors placeholder:text-(--color-ink-subtle) focus:border-(--color-brand) focus:ring-2 focus:ring-(--color-brand-subtle) disabled:cursor-not-allowed disabled:opacity-60'

/** Same control, at the more compact height inline admin rows use. */
export const CONTROL_COMPACT =
  'h-9 rounded-(--radius-control) border border-(--color-border-strong) bg-(--color-surface) px-3 text-sm text-(--color-ink) outline-none transition-colors focus:border-(--color-brand) focus:ring-2 focus:ring-(--color-brand-subtle) disabled:cursor-not-allowed disabled:opacity-60'

const buttonBase =
  'inline-flex items-center justify-center gap-1.5 rounded-(--radius-control) text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60'

export const BUTTON = {
  primary: cn(buttonBase, 'h-10 bg-(--color-brand) px-4 text-white hover:bg-(--color-brand-hover)'),
  ghost: cn(
    buttonBase,
    'h-10 border border-(--color-border-strong) px-4 font-medium text-(--color-ink-muted) hover:bg-(--color-surface-sunken) hover:text-(--color-ink)',
  ),
  danger: cn(buttonBase, 'h-10 bg-(--color-danger) px-4 text-white hover:opacity-90'),
  subtle: cn(
    buttonBase,
    'h-9 px-3 font-medium text-(--color-ink-muted) hover:bg-(--color-surface-sunken) hover:text-(--color-ink)',
  ),
  compact: cn(
    buttonBase,
    'h-9 px-3 text-(--color-ink-muted) hover:bg-(--color-surface-sunken) hover:text-(--color-ink)',
  ),
} as const

/**
 * A "back to X" link — `ChevronIcon` points toward reading-end by default
 * (see components/icons.tsx), so `rotate-180` turns it into a reading-start
 * ("back") chevron; the icon's own `rtl:` mirroring still applies on top of
 * that, so it ends up pointing the correct way in both directions.
 */
export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 text-sm font-medium text-(--color-brand) hover:underline"
    >
      <ChevronIcon className="size-3.5 rotate-180" />
      {children}
    </Link>
  )
}

/** The shared card shell behind login and the password-recovery flow. */
export function AuthShell({
  title,
  subtitle,
  footer,
  children,
}: {
  title: string
  subtitle?: string
  footer?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-16">
      <div className="space-y-6 rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface-raised) p-8 shadow-(--shadow-raised) sm:p-10">
        <header className="space-y-3 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-(--color-brand-subtle) text-(--color-brand)">
            <ScaleIcon />
          </div>
          <div className="space-y-1">
            <h1 className="text-xl font-bold text-(--color-ink)">{title}</h1>
            {subtitle ? (
              <p className="text-sm leading-relaxed text-(--color-ink-muted)">{subtitle}</p>
            ) : null}
          </div>
        </header>

        {children}
      </div>

      {footer ? <p className="mt-6 text-center text-xs text-(--color-ink-subtle)">{footer}</p> : null}
    </main>
  )
}

export function Label({
  htmlFor,
  children,
  hint,
}: {
  htmlFor: string
  children: React.ReactNode
  hint?: string
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-(--color-ink)">
        {children}
      </label>
      {hint ? <span className="text-xs text-(--color-ink-subtle)">{hint}</span> : null}
    </div>
  )
}

/** A section label for grouping controls — quieter than a full heading. */
export function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold tracking-wide text-(--color-ink-subtle)">{children}</h3>
  )
}
