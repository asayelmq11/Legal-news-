import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { COUNTRY_CODES, type CountryCode } from '@/lib/constants/countries'
import {
  DOCUMENT_TYPES,
  LEGAL_CATEGORIES,
  LEGAL_STATUSES,
  type DocumentType,
  type LegalCategory,
  type LegalStatus,
} from '@/lib/constants/taxonomy'
import { deriveSourceStatus, type SourceUiStatus } from '@/lib/sources/status'
import type { Enums } from '@/types/database'

/**
 * Dashboard aggregation.
 *
 * ┌─ HOW THE COUNTS ARE COMPUTED, AND WHY ─────────────────────────────────────┐
 * │                                                                            │
 * │ Every count here is a PostgREST `head: true, count: 'exact'` request: the   │
 * │ row payload is empty and the number arrives in the Content-Range header.    │
 * │ NO archive rows are transferred to compute any metric, however large the    │
 * │ archive grows.                                                              │
 * │                                                                            │
 * │ The obvious alternative — PostgREST aggregate functions, `select=country,   │
 * │ count()` — would collapse each dimension to a single request. It is NOT     │
 * │ used because aggregate functions are DISABLED BY DEFAULT on Supabase and    │
 * │ require `ALTER ROLE authenticator SET pgrst.db_aggregates_enabled = 'true'` │
 * │ plus a config reload. A dashboard that silently breaks unless someone       │
 * │ remembers a role setting is a worse trade than extra round trips, and the   │
 * │ milestone forbids adding a database function or view to do it server-side.  │
 * │                                                                            │
 * │ Cost: ~54 count requests, issued CONCURRENTLY, so wall-clock is roughly one │
 * │ round trip rather than fifty-four. Each is an index-only count served by    │
 * │ the composite indexes from migrations 0004 and 0012.                        │
 * │                                                                            │
 * │ If the archive ever makes this unattractive, enabling db_aggregates_enabled │
 * │ reduces it to about five requests with no schema change — see              │
 * │ docs/IMPLEMENTATION_PLAN.md §19.                                            │
 * └────────────────────────────────────────────────────────────────────────────┘
 */

export interface Bucket<T extends string> {
  key: T
  count: number
}

export interface MonthBucket {
  /** First day of the month, ISO. */
  month: string
  count: number
}

/** Metrics every authenticated user may see. */
export interface LegalOverview {
  totalUpdates: number
  byCountry: Bucket<CountryCode>[]
  byCategory: Bucket<LegalCategory>[]
  byLegalStatus: Bucket<LegalStatus>[]
  byDocumentType: Bucket<DocumentType>[]
  overTime: MonthBucket[]
  latestPublication: string | null
}

export interface SourceHealthRow {
  id: string
  authority_ar: string
  country: CountryCode
  uiStatus: SourceUiStatus
  health_status: Enums<'health_status'>
  last_success_at: string | null
  last_failure_at: string | null
  last_failure_reason: string | null
  consecutive_failures: number
  last_duration_ms: number | null
  last_items_fetched: number
  last_items_published: number
  last_items_rejected: number
}

export interface WorkflowRunSummary {
  id: string
  workflow_name: string
  status: Enums<'run_status'>
  trigger_type: Enums<'trigger_type'>
  source_id: string | null
  items_fetched: number
  items_published: number
  items_rejected: number
  error_message: string | null
  duration_ms: number | null
  started_at: string
  finished_at: string | null
}

export interface NewsletterSummary {
  totalSent: number
  totalFailed: number
  totalSkipped: number
  lastSentAt: string | null
  lastRecipientCount: number | null
}

/** Metrics restricted to administrators — operational, not legal. */
export interface OperationalOverview {
  sourceStatusCounts: Bucket<SourceUiStatus>[]
  totalSources: number
  lastSuccessfulRun: WorkflowRunSummary | null
  lastFailedRun: WorkflowRunSummary | null
  recentFailures: WorkflowRunSummary[]
  sourceHealth: SourceHealthRow[]
  newsletter: NewsletterSummary
}

export type DashboardResult<T> = { ok: true; data: T } | { ok: false; error: string }

/* -------------------------------------------------------------------------- */
/* Counting helpers                                                            */
/* -------------------------------------------------------------------------- */

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

/** Month boundaries for the trailing `months` months, oldest first. */
export function trailingMonths(months: number, now: Date): Array<{ start: string; end: string }> {
  const out: Array<{ start: string; end: string }> = []
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth()

  for (let i = months - 1; i >= 0; i -= 1) {
    const start = new Date(Date.UTC(year, month - i, 1))
    const end = new Date(Date.UTC(year, month - i + 1, 1))
    out.push({
      start: start.toISOString().slice(0, 10),
      // exclusive upper bound expressed as the last day, since the column is a date
      end: new Date(end.getTime() - 86_400_000).toISOString().slice(0, 10),
    })
  }
  return out
}

/* -------------------------------------------------------------------------- */
/* Viewer-safe legal overview                                                  */
/* -------------------------------------------------------------------------- */

export async function getLegalOverview(now = new Date()): Promise<DashboardResult<LegalOverview>> {
  const supabase = await createClient()

  /** head:true → no rows in the response body, only the count header. */
  const base = () => supabase.from('legal_updates').select('id', { count: 'exact', head: true })

  const months = trailingMonths(12, now)

  try {
    const [total, byCountry, byCategory, byLegalStatus, byDocumentType, monthly, latest] =
      await Promise.all([
        base(),
        countBuckets(COUNTRY_CODES, (c) => base().eq('country', c)),
        countBuckets(LEGAL_CATEGORIES, (c) => base().eq('category', c)),
        countBuckets(LEGAL_STATUSES, (s) => base().eq('legal_status', s)),
        countBuckets(DOCUMENT_TYPES, (d) => base().eq('document_type', d)),
        Promise.all(
          months.map(async ({ start, end }) => {
            const { count } = await base()
              .gte('publication_date', start)
              .lte('publication_date', end)
            return { month: start, count: count ?? 0 }
          }),
        ),
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
        byLegalStatus,
        byDocumentType,
        overTime: monthly,
        latestPublication: latest.data?.publication_date ?? null,
      },
    }
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : 'خطأ غير متوقع' }
  }
}

/* -------------------------------------------------------------------------- */
/* Admin-only operational overview                                             */
/* -------------------------------------------------------------------------- */

/**
 * Operational metrics. Callers must have already established that the user is
 * an admin — this does not re-check, it is called from a guarded page.
 *
 * `sources` is a small, bounded table (dozens of rows), so its health snapshot
 * is fetched directly rather than counted bucket by bucket. `workflow_logs` and
 * `newsletter_history` are read with explicit limits so neither grows into an
 * unbounded read as history accumulates.
 */
export async function getOperationalOverview(): Promise<DashboardResult<OperationalOverview>> {
  const supabase = await createClient()

  try {
    const [sources, lastSuccess, lastFailure, failures, newsletterCounts, lastNewsletter] =
      await Promise.all([
        /*
         * The column list must be a single string LITERAL: supabase-js parses
         * it at the type level to infer the row shape, and a concatenated
         * expression degrades to `string`, collapsing the result to
         * GenericStringError. Keep it on one line even though it is long.
         */
        supabase
          .from('sources')
          .select(
            'id, authority_ar, country, active, config_status, health_status, last_success_at, last_failure_at, last_failure_reason, consecutive_failures, last_duration_ms, last_items_fetched, last_items_published, last_items_rejected',
          )
          .order('consecutive_failures', { ascending: false })
          .order('authority_ar'),

        supabase
          .from('workflow_logs')
          .select('*')
          .eq('status', 'success')
          .order('started_at', { ascending: false })
          .limit(1)
          .maybeSingle(),

        supabase
          .from('workflow_logs')
          .select('*')
          .neq('status', 'success')
          .order('started_at', { ascending: false })
          .limit(1)
          .maybeSingle(),

        supabase
          .from('workflow_logs')
          .select('*')
          .neq('status', 'success')
          .order('started_at', { ascending: false })
          .limit(10),

        Promise.all(
          (['sent', 'failed', 'skipped'] as const).map(async (status) => {
            const { count } = await supabase
              .from('newsletter_history')
              .select('id', { count: 'exact', head: true })
              .eq('status', status)
            return { status, count: count ?? 0 }
          }),
        ),

        supabase
          .from('newsletter_history')
          .select('sent_at, recipient_count')
          .eq('status', 'sent')
          .order('sent_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ])

    if (sources.error) return { ok: false, error: sources.error.message }

    const rows = sources.data ?? []

    const statusTally = new Map<SourceUiStatus, number>()
    const sourceHealth: SourceHealthRow[] = rows.map((s) => {
      const uiStatus = deriveSourceStatus(s)
      statusTally.set(uiStatus, (statusTally.get(uiStatus) ?? 0) + 1)
      return {
        id: s.id,
        authority_ar: s.authority_ar,
        country: s.country,
        uiStatus,
        health_status: s.health_status,
        last_success_at: s.last_success_at,
        last_failure_at: s.last_failure_at,
        last_failure_reason: s.last_failure_reason,
        consecutive_failures: s.consecutive_failures,
        last_duration_ms: s.last_duration_ms,
        last_items_fetched: s.last_items_fetched,
        last_items_published: s.last_items_published,
        last_items_rejected: s.last_items_rejected,
      }
    })

    const tally = (status: 'sent' | 'failed' | 'skipped') =>
      newsletterCounts.find((n) => n.status === status)?.count ?? 0

    return {
      ok: true,
      data: {
        totalSources: rows.length,
        sourceStatusCounts: [...statusTally.entries()]
          .map(([key, count]) => ({ key, count }))
          .sort((a, b) => b.count - a.count),
        lastSuccessfulRun: (lastSuccess.data as WorkflowRunSummary | null) ?? null,
        lastFailedRun: (lastFailure.data as WorkflowRunSummary | null) ?? null,
        recentFailures: (failures.data as WorkflowRunSummary[] | null) ?? [],
        sourceHealth,
        newsletter: {
          totalSent: tally('sent'),
          totalFailed: tally('failed'),
          totalSkipped: tally('skipped'),
          lastSentAt: lastNewsletter.data?.sent_at ?? null,
          lastRecipientCount: lastNewsletter.data?.recipient_count ?? null,
        },
      },
    }
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : 'خطأ غير متوقع' }
  }
}

/** Most recent published updates, for the dashboard's activity list. */
export async function getRecentUpdates(limit = 5) {
  const supabase = await createClient()
  const { data } = await supabase
    .from('legal_updates')
    .select('id, title_ar, country, category, publication_date')
    .order('publication_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit)

  return data ?? []
}
