import 'server-only'

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

/** Most recent published updates — the dashboard's primary content. */
export async function getRecentUpdates(limit = 15) {
  const supabase = await createClient()
  const { data } = await supabase
    .from('legal_updates')
    .select('id, title_ar, summary_ar, source_url, country, category, publication_date, sources ( authority_ar )')
    .order('publication_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit)

  return data ?? []
}
