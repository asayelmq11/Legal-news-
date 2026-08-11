import type { DocumentType, LegalStatus } from '@/lib/constants/taxonomy'

/**
 * "نوع المحتوى" — a small, UI-facing grouping derived entirely from the
 * existing `document_type` + `legal_status` (+ `category` for the litigation
 * carve-out) columns. Not a new schema concept: every bucket here maps onto
 * values the classifier already writes (see n8n/prompts/classify-legal-update.md).
 *
 * Defined ONCE and consumed by both the archive's query-level filter
 * (`contentTypeOrExpr`, a PostgREST `.or()` fragment) and the dashboard's
 * client-side bucketing (`resolveContentType`, run over an already-fetched
 * page of rows) — so "what counts as an amendment" can never drift between
 * the two call sites.
 */
export const CONTENT_TYPE_KEYS = ['law', 'amendment', 'regulation', 'decision', 'case', 'other'] as const
export type ContentTypeKey = (typeof CONTENT_TYPE_KEYS)[number]

export const CONTENT_TYPE_LABELS_AR: Readonly<Record<ContentTypeKey, string>> = {
  law: 'تشريع / نظام',
  amendment: 'تعديل تشريعي',
  regulation: 'لائحة / تنظيم',
  decision: 'قرار / تعميم',
  case: 'قضية / حكم',
  other: 'خبر قانوني آخر',
}

/**
 * `document_type` values belonging to each bucket, for the buckets that key
 * off `document_type` alone. `amendment` and `case` are evaluated first and
 * separately below (they key off `legal_status`/`category`, which can apply
 * across otherwise-different `document_type`s).
 */
const DOCUMENT_TYPES_BY_BUCKET: Readonly<Record<'law' | 'regulation' | 'decision' | 'other', readonly DocumentType[]>> = {
  law: ['law', 'royal_decree'],
  regulation: ['executive_regulation', 'regulatory_framework'],
  decision: ['ministerial_decision', 'circular', 'official_notice'],
  other: ['other', 'consultation_draft'],
}

/** Shown for rows with `document_type = null` — pre-existing records from before this field was re-enabled. Never guessed into a real bucket. */
export const UNCLASSIFIED_LABEL_AR = 'غير مصنَّف'

/**
 * Buckets an already-fetched row for dashboard charts/sections. Priority
 * matches the classify prompt's own field independence: an amendment is
 * flagged by `legal_status` regardless of its `document_type`; a case is
 * flagged by `document_type = court_precedent` OR `category = litigation`
 * (an ongoing case with no ruling yet still has `document_type = other`),
 * regardless of what the model happened to pick for `document_type`.
 */
export function resolveContentType(row: {
  document_type: DocumentType | null
  legal_status: LegalStatus | null
  category: string
}): ContentTypeKey | 'unclassified' {
  if (row.document_type === null) return 'unclassified'
  if (row.legal_status === 'amended') return 'amendment'
  if (row.document_type === 'court_precedent' || row.category === 'litigation') return 'case'
  for (const key of ['law', 'regulation', 'decision', 'other'] as const) {
    if ((DOCUMENT_TYPES_BY_BUCKET[key] as readonly string[]).includes(row.document_type)) return key
  }
  return 'other'
}

/** `resolveContentType` plus its Arabic label — the one-call form editorial rows use. */
export function contentTypeLabel(row: {
  document_type: DocumentType | null
  legal_status: LegalStatus | null
  category: string
}): string {
  const bucket = resolveContentType(row)
  return bucket === 'unclassified' ? UNCLASSIFIED_LABEL_AR : CONTENT_TYPE_LABELS_AR[bucket]
}

/**
 * A PostgREST `.or()` fragment for one bucket — used by the archive's
 * "نوع المحتوى" filter. Multiple selected buckets are joined with `,`
 * (PostgREST OR is flat/associative, so nesting the `case` bucket's own
 * two-condition OR inside a larger comma-joined list is still correct).
 *
 * `case` is the one bucket that keys partly off `category`, a column pre-existing
 * NULL-`document_type` records already have populated — without the
 * `document_type.not.is.null` guard, an old unclassified record tagged
 * `category = litigation` would match this filter even though
 * `resolveContentType` (which checks `document_type === null` FIRST, before
 * ever looking at `category`) buckets that same row as `unclassified`. The
 * guard keeps the two in agreement on old records, not just new ones.
 */
export function contentTypeOrExpr(key: ContentTypeKey): string {
  switch (key) {
    case 'law':
      return 'document_type.in.(law,royal_decree)'
    case 'amendment':
      return 'legal_status.eq.amended'
    case 'regulation':
      return 'document_type.in.(executive_regulation,regulatory_framework)'
    case 'decision':
      return 'document_type.in.(ministerial_decision,circular,official_notice)'
    case 'case':
      return 'and(document_type.not.is.null,or(document_type.eq.court_precedent,category.eq.litigation))'
    case 'other':
      return 'document_type.in.(other,consultation_draft)'
  }
}

/** `document_type` values that count as "أهم المستجدات التشريعية والتنظيمية" on the dashboard — everything except case rulings and the residual "other" bucket. */
export const LEGISLATIVE_DOCUMENT_TYPES: readonly DocumentType[] = [
  'law',
  'royal_decree',
  'executive_regulation',
  'regulatory_framework',
  'ministerial_decision',
  'circular',
  'official_notice',
]

/**
 * The Dashboard KPI strip's four content-type cards — a *partition* of
 * `document_type`, not a filter: every row with a non-null `document_type`
 * falls into exactly one of these four, so the four counts always sum to
 * the classified total. This is deliberately a different, simpler grouping
 * than `resolveContentType` above: that one keys `amendment` off
 * `legal_status` and `case` off `category` too (useful for the archive's
 * filter, where "show me amendments" is a legitimate cross-cutting query),
 * which is exactly why summing ITS buckets does not equal the total — a
 * `law` row with `legal_status = amended` counts once, under `amendment`,
 * so `law` undercounts by however many amendments happen to be laws. The
 * KPI strip needs the other property (a clean breakdown of "what is this
 * archive made of"), so it uses `document_type` alone, with no
 * `legal_status`/`category` override.
 */
export const DASHBOARD_KPI_GROUP_KEYS = ['legislative', 'decision', 'case', 'other'] as const
export type DashboardKpiGroup = (typeof DASHBOARD_KPI_GROUP_KEYS)[number]

export const DASHBOARD_KPI_GROUP_LABELS_AR: Readonly<Record<DashboardKpiGroup, string>> = {
  legislative: 'تشريعات وتنظيمات',
  decision: 'قرارات وتعاميم',
  case: 'قضايا وأحكام',
  other: 'محتوى قانوني آخر',
}

const DOCUMENT_TYPES_BY_KPI_GROUP: Readonly<Record<DashboardKpiGroup, readonly DocumentType[]>> = {
  legislative: ['law', 'royal_decree', 'executive_regulation', 'regulatory_framework'],
  decision: ['ministerial_decision', 'circular', 'official_notice'],
  case: ['court_precedent'],
  other: ['other', 'consultation_draft'],
}

/**
 * Buckets a row for the KPI strip. `document_type = null` (a record from
 * before this field existed) is `'unclassified'` and excluded from the
 * four-group sum, exactly like `resolveContentType`'s own `unclassified`
 * handling — the strip's footnote makes that count visible rather than
 * silently folding it into one of the four and overstating that group.
 */
export function resolveDashboardKpiGroup(documentType: DocumentType | null): DashboardKpiGroup | 'unclassified' {
  if (documentType === null) return 'unclassified'
  for (const key of DASHBOARD_KPI_GROUP_KEYS) {
    if ((DOCUMENT_TYPES_BY_KPI_GROUP[key] as readonly string[]).includes(documentType)) return key
  }
  // Unreachable while DOCUMENT_TYPES_BY_KPI_GROUP covers every DocumentType
  // member (enforced by the exhaustiveness test in content-type.test.ts) —
  // kept as a safe fallback rather than a thrown error, since a KPI strip
  // is exactly the wrong place to crash the dashboard over a taxonomy gap.
  return 'other'
}
