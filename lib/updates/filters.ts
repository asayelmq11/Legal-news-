import { z } from 'zod'

import { CONTENT_TYPE_KEYS } from '@/lib/constants/content-type'
import { COUNTRY_CODES } from '@/lib/constants/countries'
import { LEGAL_CATEGORIES } from '@/lib/constants/taxonomy'

/**
 * Archive filter parsing.
 *
 * Every value reaching the query layer passes through here first. Unknown or
 * malformed input is DROPPED rather than rejected: a stale bookmark or a
 * hand-edited URL should show the archive, not an error page. Anything that
 * survives is a member of a known enum, a bounded number, or an ISO date — so
 * the query layer never receives a value it has to sanitise itself.
 *
 * Nothing here builds SQL. Values are handed to typed PostgREST filter methods
 * (.eq/.in/.gte), so user input can only ever be a *value*, never part of the
 * query's structure.
 */

export const PAGE_SIZE = 20
export const MAX_PAGE_SIZE = 50
/** Guards against a hand-typed `?page=999999` forcing a huge OFFSET scan. */
export const MAX_PAGE = 500

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** Accepts `?country=SA&country=AE` and `?country=SA,AE` alike. */
function multiEnum<T extends readonly [string, ...string[]]>(values: T) {
  const allowed = new Set<string>(values)
  return z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((raw): T[number][] => {
      if (raw === undefined) return []
      const parts = (Array.isArray(raw) ? raw : [raw]).flatMap((v) => v.split(','))
      const kept = parts.map((p) => p.trim()).filter((p) => allowed.has(p))
      return [...new Set(kept)] as T[number][]
    })
}

function isoDate() {
  return z
    .string()
    .optional()
    .transform((v) => {
      if (!v || !ISO_DATE.test(v)) return undefined
      // Reject impossible dates that match the shape, e.g. 2026-02-31.
      const d = new Date(`${v}T00:00:00Z`)
      if (Number.isNaN(d.getTime())) return undefined
      return d.toISOString().slice(0, 10) === v ? v : undefined
    })
}

const searchParamsSchema = z.object({
  q: z
    .string()
    .optional()
    .transform((v) => {
      const trimmed = (v ?? '').trim()
      // 200 characters is far beyond any real legal query and keeps a pasted
      // document out of the query planner.
      return trimmed.length === 0 || trimmed.length > 200 ? '' : trimmed
    }),
  country: multiEnum(COUNTRY_CODES),
  category: multiEnum(LEGAL_CATEGORIES),
  contentType: multiEnum(CONTENT_TYPE_KEYS),
  source: z
    .string()
    .optional()
    .transform((v) => (v && z.uuid().safeParse(v).success ? v : undefined)),
  publishedFrom: isoDate(),
  publishedTo: isoDate(),
  page: z
    .string()
    .optional()
    .transform((v) => {
      const n = Number(v ?? '1')
      if (!Number.isInteger(n) || n < 1) return 1
      return Math.min(n, MAX_PAGE)
    }),
  pageSize: z
    .string()
    .optional()
    .transform((v) => {
      const n = Number(v ?? String(PAGE_SIZE))
      if (!Number.isInteger(n) || n < 1) return PAGE_SIZE
      return Math.min(n, MAX_PAGE_SIZE)
    }),
})

export type ArchiveFilters = z.infer<typeof searchParamsSchema>

/** Raw shape Next hands to a page from `searchParams`. */
export type RawSearchParams = Record<string, string | string[] | undefined>

/**
 * Collapses a repeated scalar parameter to its first value.
 *
 * A URL can legitimately carry `?page=1&page=2`, and Next surfaces that as an
 * array. The list-valued filters below want every entry, but a scalar like
 * `page` or `q` has to pick one — taking the first is what a browser form does
 * and what a user re-submitting a URL would expect.
 */
function first(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}

export function parseArchiveFilters(raw: RawSearchParams): ArchiveFilters {
  // .parse, not .safeParse: every field has a fallback transform, so this
  // cannot throw. Malformed input degrades to "no filter".
  const parsed = searchParamsSchema.parse({
    q: first(raw.q),
    // list-valued: every entry is kept
    country: raw.country,
    category: raw.category,
    contentType: raw.contentType,
    // scalar: a repeated parameter collapses to its first value
    source: first(raw.source),
    publishedFrom: first(raw.publishedFrom),
    publishedTo: first(raw.publishedTo),
    page: first(raw.page),
    pageSize: first(raw.pageSize),
  })

  // Swap inverted ranges rather than returning nothing. A user who picks the
  // dates in the wrong order meant a range, not an empty set.
  const publishedRange = orderRange(parsed.publishedFrom, parsed.publishedTo)

  return {
    ...parsed,
    publishedFrom: publishedRange[0],
    publishedTo: publishedRange[1],
  }
}

function orderRange<T extends string | number>(
  from: T | undefined,
  to: T | undefined,
): [T | undefined, T | undefined] {
  if (from !== undefined && to !== undefined && from > to) return [to, from]
  return [from, to]
}

/** True when anything narrows the archive — drives the "clear filters" control. */
export function hasActiveFilters(f: ArchiveFilters): boolean {
  return (
    f.q !== '' ||
    f.country.length > 0 ||
    f.category.length > 0 ||
    f.contentType.length > 0 ||
    f.source !== undefined ||
    f.publishedFrom !== undefined ||
    f.publishedTo !== undefined
  )
}

/**
 * Rebuilds a query string from parsed filters, so the URL always reflects the
 * state actually applied — a bookmarked search reproduces exactly what the user
 * saw, and junk parameters are dropped rather than carried forward.
 */
export function buildArchiveQuery(
  f: ArchiveFilters,
  overrides: Partial<{ page: number }> = {},
): string {
  const params = new URLSearchParams()
  const page = overrides.page ?? f.page

  if (f.q) params.set('q', f.q)
  for (const c of f.country) params.append('country', c)
  for (const c of f.category) params.append('category', c)
  for (const c of f.contentType) params.append('contentType', c)
  if (f.source) params.set('source', f.source)
  if (f.publishedFrom) params.set('publishedFrom', f.publishedFrom)
  if (f.publishedTo) params.set('publishedTo', f.publishedTo)
  if (f.pageSize !== PAGE_SIZE) params.set('pageSize', String(f.pageSize))
  if (page > 1) params.set('page', String(page))

  const qs = params.toString()
  return qs ? `?${qs}` : ''
}
