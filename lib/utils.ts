/**
 * Small shared helpers. Kept dependency-free on purpose — `clsx`/`tailwind-merge`
 * are not worth adding for the handful of conditional classes this app needs.
 */

/** Joins class names, dropping falsy entries. */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ')
}

/**
 * Formats a date for display in Arabic using Gregorian months, which is what
 * official gazettes use for publication dates.
 */
export function formatDateAr(value: string | Date | null | undefined, timeZone = 'Asia/Riyadh'): string {
  if (!value) return '—'
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return '—'

  return new Intl.DateTimeFormat('ar', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone,
  }).format(date)
}

/**
 * Extracts a hostname for domain allow-list display. Returns null for input
 * that is not a parseable absolute URL rather than throwing.
 */
export function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}
