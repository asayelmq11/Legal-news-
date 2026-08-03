import 'server-only'

import { createClient } from '@/lib/supabase/server'
import {
  escapeLikePattern,
  MIN_FUZZY_LENGTH,
  normalizeSearchQuery,
} from '@/lib/search/arabic'
import type { ArchiveFilters } from '@/lib/updates/filters'
import type { Enums } from '@/types/database'

/**
 * Archive reads.
 *
 * Every query is built with typed PostgREST methods — .eq / .in / .gte /
 * .overlaps / .textSearch. There is no string concatenation and no RPC taking
 * SQL, so a user's input can only ever land in a *value* position.
 *
 * The source is joined via an embedded resource rather than fetched per row, so
 * a page of 20 updates costs one round trip, not 21.
 */

/** Columns every reader may see. `confidence` is deliberately absent. */
const BASE_COLUMNS = `
  id, source_id, source_url, title_ar, summary_ar, country, category,
  document_type, legal_status, publication_date, effective_date,
  affected_entities, keywords, document_path, created_at,
  sources ( id, authority_ar, authority_en, source_type, base_url, allowed_domains )
`

/**
 * Admin projection. `confidence` and `ai_model` are operational metadata about
 * how the item was classified, not part of the legal record.
 *
 * NOTE ON WHAT THIS IS AND IS NOT: withholding the column here means the
 * application never transmits it to a viewer. It is NOT a database-level
 * control — `admin` and `viewer` are rows in public.users, not Postgres roles,
 * so column-level grants cannot distinguish them and RLS permits both to select
 * the column. A viewer using a raw API client with their own token could still
 * read it. Making that impossible would need separate Postgres roles; see the
 * note in docs/IMPLEMENTATION_PLAN.md §17.
 */
const ADMIN_COLUMNS = `${BASE_COLUMNS}, confidence, ai_model, content_hash, origin_type, canonical_url, discovery_engine`

export interface SourceRef {
  id: string
  authority_ar: string
  authority_en: string
  source_type: Enums<'source_type'>
  base_url: string
  allowed_domains: string[]
}

export interface ArchiveItem {
  id: string
  source_id: string
  source_url: string
  title_ar: string
  summary_ar: string
  country: Enums<'country_code'>
  category: Enums<'legal_category'>
  document_type: Enums<'document_type'>
  legal_status: Enums<'legal_status'>
  publication_date: string
  effective_date: string | null
  affected_entities: string[]
  keywords: string[]
  document_path: string | null
  created_at: string
  sources: SourceRef | null
  /** Present only when the reader is an admin. */
  confidence?: number
  ai_model?: string
  content_hash?: string
  origin_type?: Enums<'origin_type'>
  canonical_url?: string | null
  discovery_engine?: string | null
}

export interface ArchivePage {
  items: ArchiveItem[]
  total: number
  page: number
  pageSize: number
  pageCount: number
  /** True when the exact-match search found nothing and trigram results are shown. */
  usedFuzzyFallback: boolean
}

export type ArchiveResult =
  | { ok: true; data: ArchivePage }
  | { ok: false; error: string }

/**
 * Applies every filter except search. Shared by the exact and fuzzy passes so
 * the two cannot drift apart — a fuzzy fallback that quietly dropped the
 * country filter would be worse than no fallback.
 */
function applyFilters<T extends {
  in: (col: string, vals: readonly string[]) => T
  eq: (col: string, val: string) => T
  gte: (col: string, val: string | number) => T
  lte: (col: string, val: string | number) => T
  overlaps: (col: string, vals: readonly string[]) => T
  not: (col: string, op: string, val: null) => T
}>(query: T, f: ArchiveFilters): T {
  let q = query

  if (f.country.length) q = q.in('country', f.country)
  if (f.category.length) q = q.in('category', f.category)
  if (f.documentType.length) q = q.in('document_type', f.documentType)
  if (f.legalStatus.length) q = q.in('legal_status', f.legalStatus)
  if (f.source) q = q.eq('source_id', f.source)

  // Array containment — served by the GIN indexes on these columns.
  if (f.entity.length) q = q.overlaps('affected_entities', f.entity)
  if (f.keyword.length) q = q.overlaps('keywords', f.keyword)

  if (f.publishedFrom) q = q.gte('publication_date', f.publishedFrom)
  if (f.publishedTo) q = q.lte('publication_date', f.publishedTo)

  if (f.effectiveFrom || f.effectiveTo) {
    // Rows with no effective date can never satisfy an effective-date range,
    // and excluding them explicitly lets the planner use the partial index.
    q = q.not('effective_date', 'is', null)
    if (f.effectiveFrom) q = q.gte('effective_date', f.effectiveFrom)
    if (f.effectiveTo) q = q.lte('effective_date', f.effectiveTo)
  }

  // Parsed to undefined for non-admins upstream, so this is unreachable for them.
  if (f.confidenceMin !== undefined) q = q.gte('confidence', f.confidenceMin)
  if (f.confidenceMax !== undefined) q = q.lte('confidence', f.confidenceMax)

  return q
}

export async function listArchive(
  filters: ArchiveFilters,
  options: { isAdmin: boolean },
): Promise<ArchiveResult> {
  const supabase = await createClient()
  const columns = options.isAdmin ? ADMIN_COLUMNS : BASE_COLUMNS

  const from = (filters.page - 1) * filters.pageSize
  const to = from + filters.pageSize - 1

  const run = async (mode: 'exact' | 'fuzzy' | 'none') => {
    let q = supabase.from('legal_updates').select(columns, { count: 'exact' })
    q = applyFilters(q, filters)

    if (mode === 'exact') {
      /*
       * The query term is folded with the SAME transformation baked into the
       * generated search_vector — without it, 'ضريبة' would never match a
       * vector holding 'ضريبه'.
       *
       * `type: 'plain'` maps to plainto_tsquery, which treats the input as
       * literal terms. A user typing `&`, `|` or `!` gets those characters
       * searched for, not interpreted as tsquery operators — so the search box
       * cannot express a query the UI did not intend.
       */
      q = q.textSearch('search_vector', normalizeSearchQuery(filters.q), {
        type: 'plain',
        config: 'simple',
      })
    } else if (mode === 'fuzzy') {
      /*
       * Trigram fallback, served by legal_updates_title_trgm_idx.
       *
       * Matches the RAW input, not the normalised form: title_ar is stored
       * unfolded, so folding here would search for characters that are not in
       * the column. LIKE metacharacters are escaped so `%` cannot match
       * everything.
       */
      q = q.ilike('title_ar', `%${escapeLikePattern(filters.q)}%`)
    }

    return q
      .order('publication_date', { ascending: false })
      .order('created_at', { ascending: false })
      .range(from, to)
  }

  try {
    const searching = filters.q !== ''
    let usedFuzzyFallback = false

    const exact = await run(searching ? 'exact' : 'none')
    if (exact.error) return { ok: false, error: exact.error.message }

    let data = exact.data
    let count = exact.count

    // Only when an exact search found nothing is the fuzzy pass worth a second
    // round trip — and only for a term long enough to be selective.
    if (searching && (count ?? 0) === 0 && filters.q.length >= MIN_FUZZY_LENGTH) {
      const fuzzy = await run('fuzzy')
      if (!fuzzy.error) {
        data = fuzzy.data
        count = fuzzy.count
        usedFuzzyFallback = (fuzzy.count ?? 0) > 0
      }
    }

    const total = count ?? 0
    return {
      ok: true,
      data: {
        items: (data ?? []) as unknown as ArchiveItem[],
        total,
        page: filters.page,
        pageSize: filters.pageSize,
        pageCount: Math.max(1, Math.ceil(total / filters.pageSize)),
        usedFuzzyFallback,
      },
    }
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : 'خطأ غير متوقع' }
  }
}

export async function getArchiveItem(
  id: string,
  options: { isAdmin: boolean },
): Promise<ArchiveItem | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('legal_updates')
    .select(options.isAdmin ? ADMIN_COLUMNS : BASE_COLUMNS)
    .eq('id', id)
    .maybeSingle()

  if (error || !data) return null
  return data as unknown as ArchiveItem
}

/** Sources that actually have archived items — the only ones worth offering as a filter. */
export async function listFilterSources(): Promise<
  Array<{ id: string; authority_ar: string; country: Enums<'country_code'> }>
> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('sources')
    .select('id, authority_ar, country')
    .order('country')
    .order('authority_ar')

  return data ?? []
}

/**
 * Groups a page of results by publication date for the timeline view.
 *
 * Operates on the CURRENT PAGE ONLY. Filtering, sorting and pagination all
 * happen in Postgres; this is presentation over at most `pageSize` rows and
 * never pulls the archive into memory.
 */
export function groupByPublicationDate(
  items: readonly ArchiveItem[],
): Array<{ date: string; items: ArchiveItem[] }> {
  const groups = new Map<string, ArchiveItem[]>()
  for (const item of items) {
    const existing = groups.get(item.publication_date)
    if (existing) existing.push(item)
    else groups.set(item.publication_date, [item])
  }
  // Insertion order already follows the SQL ordering (publication_date desc).
  return [...groups.entries()].map(([date, groupItems]) => ({ date, items: groupItems }))
}
