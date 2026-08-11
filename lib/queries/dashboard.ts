import 'server-only'

import {
  CONTENT_TYPE_KEYS,
  LEGISLATIVE_DOCUMENT_TYPES,
  resolveContentType,
  type ContentTypeKey,
} from '@/lib/constants/content-type'
import { createClient } from '@/lib/supabase/server'
import { COUNTRY_CODES, type CountryCode } from '@/lib/constants/countries'
import { LEGAL_CATEGORIES, type LegalCategory } from '@/lib/constants/taxonomy'

/**
 * Dashboard aggregation.
 *
 * Every count is a PostgREST `head: true, count: 'exact'` request: the row
 * payload is empty and the number arrives in the Content-Range header. No
 * archive rows are transferred to compute a metric, however large the
 * archive grows.
 */

export interface Bucket<T extends string> {
  key: T
  count: number
}

/** Metrics every authenticated user may see. */
export interface LegalOverview {
  totalUpdates: number
  byCountry: Bucket<CountryCode>[]
  byCategory: Bucket<LegalCategory>[]
  latestPublication: string | null
}

export type DashboardResult<T> = { ok: true; data: T } | { ok: false; error: string }

type CountQuery = { count: number | null; error: { message: string } | null }

/**
 * Runs bucketed counts concurrently and returns only the non-empty buckets.
 *
 * Empty buckets are dropped rather than rendered as zeros: a dashboard listing
 * eighteen categories of which fifteen read "0" hides the three that matter.
 */
async function countBuckets<T extends string>(
  keys: readonly T[],
  run: (key: T) => PromiseLike<CountQuery>,
): Promise<Bucket<T>[]> {
  const results = await Promise.all(
    keys.map(async (key) => ({ key, result: await run(key) })),
  )

  return results
    .filter(({ result }) => !result.error && (result.count ?? 0) > 0)
    .map(({ key, result }) => ({ key, count: result.count ?? 0 }))
    .sort((a, b) => b.count - a.count)
}

/**
 * `byCountry` still runs over the full `COUNTRY_CODES` (GCC included) — it's
 * the general-purpose count, reused by the country distribution *and* kept
 * available for anything else that legitimately wants the true total
 * including the Secretariat's own content. Individual call sites (the
 * country chart) are what exclude GCC as "not a state", not this query.
 */
export async function getLegalOverview(): Promise<DashboardResult<LegalOverview>> {
  const supabase = await createClient()

  /** head:true → no rows in the response body, only the count header. */
  const base = () => supabase.from('legal_updates').select('id', { count: 'exact', head: true })

  try {
    const [total, byCountry, byCategory, latest] = await Promise.all([
      base(),
      countBuckets(COUNTRY_CODES, (c) => base().eq('country', c)),
      countBuckets(LEGAL_CATEGORIES, (c) => base().eq('category', c)),
      // Single row, not a scan: ordered by an indexed column with limit 1.
      supabase
        .from('legal_updates')
        .select('publication_date')
        .order('publication_date', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    if (total.error) return { ok: false, error: total.error.message }

    return {
      ok: true,
      data: {
        totalUpdates: total.count ?? 0,
        byCountry,
        byCategory,
        latestPublication: latest.data?.publication_date ?? null,
      },
    }
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : 'خطأ غير متوقع' }
  }
}

/**
 * "مؤشرات حسب نوع المستجد" — one row per record, bucketed client-side by
 * `resolveContentType` (the same function the archive's "نوع المحتوى" filter
 * is built from, so the dashboard chart and the filter can never disagree on
 * what counts as an amendment or a case). Fetches only the three thin columns
 * needed to bucket, not full rows — the archive is small enough (a few
 * hundred rows) that this beats maintaining six separate count queries that
 * would have to be hand-kept in sync with the bucket rules instead.
 *
 * `unclassified` (document_type IS NULL — records from before this field was
 * re-enabled) is kept as its own bucket rather than folded into another one
 * or silently dropped: hiding it would overstate how much of the archive is
 * actually typed.
 */
export interface DocumentTypeDistribution {
  buckets: Bucket<ContentTypeKey | 'unclassified'>[]
  classifiedTotal: number
}

export async function getDocumentTypeDistribution(): Promise<DashboardResult<DocumentTypeDistribution>> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('legal_updates').select('document_type, legal_status, category')

  if (error) return { ok: false, error: error.message }

  const counts = new Map<ContentTypeKey | 'unclassified', number>()
  let classifiedTotal = 0
  for (const row of data ?? []) {
    const bucket = resolveContentType(row)
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1)
    if (bucket !== 'unclassified') classifiedTotal += 1
  }

  const order: readonly (ContentTypeKey | 'unclassified')[] = [...CONTENT_TYPE_KEYS, 'unclassified']
  const buckets = order
    .map((key) => ({ key, count: counts.get(key) ?? 0 }))
    .filter((b) => b.count > 0)

  return { ok: true, data: { buckets, classifiedTotal } }
}

/** One row in "أهم المستجدات التشريعية والتنظيمية" or "أحدث المحتوى القانوني الكامل". */
export interface DashboardUpdateRow {
  id: string
  title_ar: string
  summary_ar: string
  source_url: string
  country: CountryCode
  category: LegalCategory
  document_type: import('@/lib/constants/taxonomy').DocumentType | null
  legal_status: import('@/lib/constants/taxonomy').LegalStatus | null
  publication_date: string
  sources: { authority_ar: string } | null
}

const DASHBOARD_ROW_COLUMNS =
  'id, title_ar, summary_ar, source_url, country, category, document_type, legal_status, publication_date, sources ( authority_ar )'

/**
 * "أهم المستجدات التشريعية والتنظيمية" — the dashboard's lead section.
 * Filtered to `document_type` values that are genuinely legislative/
 * regulatory/administrative instruments (`LEGISLATIVE_DOCUMENT_TYPES`) —
 * deliberately excludes `court_precedent` (its own "آخر القضايا" section),
 * `other`/`consultation_draft`, and — because the filter is an `.in()` over
 * real values — anything with `document_type = null` as well, so a record
 * this platform hasn't classified yet never gets miscounted as "new
 * legislation" just by being recent.
 */
export async function getTopLegislativeUpdates(limit = 8): Promise<DashboardUpdateRow[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('legal_updates')
    .select(DASHBOARD_ROW_COLUMNS)
    .in('document_type', LEGISLATIVE_DOCUMENT_TYPES)
    .order('publication_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit)

  return (data ?? []) as unknown as DashboardUpdateRow[]
}

/**
 * "آخر القضايا والأحكام" — `category = 'litigation'` is the same filter the
 * Publishing Gate and the classify prompt already treat as the source of
 * truth for "this is a case", independent of `document_type` (an ongoing
 * case with no ruling yet is still `category = litigation` even though its
 * `document_type` is `other`, not `court_precedent`).
 */
export async function getRecentCases(limit = 8): Promise<DashboardUpdateRow[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('legal_updates')
    .select(DASHBOARD_ROW_COLUMNS)
    .eq('category', 'litigation')
    .order('publication_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit)

  return (data ?? []) as unknown as DashboardUpdateRow[]
}

/** "أحدث المحتوى القانوني الكامل" — everything, unfiltered, newest first. */
export async function getRecentUpdates(limit = 15): Promise<DashboardUpdateRow[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('legal_updates')
    .select(DASHBOARD_ROW_COLUMNS)
    .order('publication_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit)

  return (data ?? []) as unknown as DashboardUpdateRow[]
}
