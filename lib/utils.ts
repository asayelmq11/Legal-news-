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

/** Same as formatDateAr, plus the time — for "آخر تحديث ناجح: …" timestamps. */
export function formatDateTimeAr(value: string | Date | null | undefined, timeZone = 'Asia/Riyadh'): string {
  if (!value) return '—'
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return '—'

  return new Intl.DateTimeFormat('ar', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    timeZone,
  }).format(date)
}

/**
 * "اليوم" / "أمس" for a publication date, else null so the caller falls back
 * to the full formatted date. Compared as calendar dates in the same time
 * zone `formatDateAr` uses, not as a 24-hour window, so a document published
 * at 11pm Riyadh time still reads as "today" until the Riyadh calendar date
 * turns over.
 */
export function relativeDayAr(value: string, timeZone = 'Asia/Riyadh'): string | null {
  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date())
  if (value === todayStr) return 'اليوم'

  const yesterday = new Date(`${todayStr}T00:00:00Z`)
  yesterday.setUTCDate(yesterday.getUTCDate() - 1)
  if (value === yesterday.toISOString().slice(0, 10)) return 'أمس'

  return null
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
