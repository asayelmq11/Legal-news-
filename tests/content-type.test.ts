import { describe, expect, it } from 'vitest'

import {
  CONTENT_TYPE_KEYS,
  contentTypeOrExpr,
  DASHBOARD_KPI_GROUP_KEYS,
  DASHBOARD_KPI_GROUP_LABELS_AR,
  resolveContentType,
  resolveDashboardKpiGroup,
} from '@/lib/constants/content-type'
import { DOCUMENT_TYPES } from '@/lib/constants/taxonomy'

describe('resolveContentType', () => {
  it('is unclassified when document_type is null — never guessed', () => {
    expect(resolveContentType({ document_type: null, legal_status: null, category: 'general' })).toBe(
      'unclassified',
    )
  })

  it('amendment wins on legal_status=amended regardless of document_type', () => {
    expect(resolveContentType({ document_type: 'law', legal_status: 'amended', category: 'general' })).toBe(
      'amendment',
    )
    expect(
      resolveContentType({ document_type: 'executive_regulation', legal_status: 'amended', category: 'trade' }),
    ).toBe('amendment')
  })

  it('case is document_type=court_precedent OR category=litigation, never guessed from document_type=other alone', () => {
    expect(resolveContentType({ document_type: 'court_precedent', legal_status: null, category: 'general' })).toBe(
      'case',
    )
    // An ongoing case with no ruling yet: document_type='other', but category=litigation still marks it a case.
    expect(resolveContentType({ document_type: 'other', legal_status: null, category: 'litigation' })).toBe('case')
  })

  it('maps law/royal_decree to law, executive_regulation/regulatory_framework to regulation, decisions to decision', () => {
    expect(resolveContentType({ document_type: 'law', legal_status: null, category: 'general' })).toBe('law')
    expect(resolveContentType({ document_type: 'royal_decree', legal_status: null, category: 'general' })).toBe('law')
    expect(
      resolveContentType({ document_type: 'executive_regulation', legal_status: null, category: 'general' }),
    ).toBe('regulation')
    expect(
      resolveContentType({ document_type: 'regulatory_framework', legal_status: null, category: 'general' }),
    ).toBe('regulation')
    expect(
      resolveContentType({ document_type: 'ministerial_decision', legal_status: null, category: 'general' }),
    ).toBe('decision')
    expect(resolveContentType({ document_type: 'circular', legal_status: null, category: 'general' })).toBe(
      'decision',
    )
    expect(resolveContentType({ document_type: 'official_notice', legal_status: null, category: 'general' })).toBe(
      'decision',
    )
  })

  it('falls back to other for consultation_draft/other', () => {
    expect(resolveContentType({ document_type: 'other', legal_status: null, category: 'general' })).toBe('other')
    expect(
      resolveContentType({ document_type: 'consultation_draft', legal_status: null, category: 'general' }),
    ).toBe('other')
  })
})

describe('contentTypeOrExpr', () => {
  it('produces a valid-looking PostgREST OR fragment for every key, and every key has one', () => {
    for (const key of CONTENT_TYPE_KEYS) {
      const expr = contentTypeOrExpr(key)
      expect(expr.length).toBeGreaterThan(0)
      expect(expr).not.toContain(' ') // PostgREST filter syntax has no spaces
    }
  })

  it('the case bucket covers both court_precedent and litigation', () => {
    const expr = contentTypeOrExpr('case')
    expect(expr).toContain('document_type.eq.court_precedent')
    expect(expr).toContain('category.eq.litigation')
  })

  it('the amendment bucket keys off legal_status, not document_type', () => {
    expect(contentTypeOrExpr('amendment')).toBe('legal_status.eq.amended')
  })
})

describe('resolveDashboardKpiGroup — the KPI strip\'s partition of document_type', () => {
  it('is unclassified when document_type is null — never guessed', () => {
    expect(resolveDashboardKpiGroup(null)).toBe('unclassified')
  })

  it('groups per the KPI spec: legislative, decision, case, other', () => {
    expect(resolveDashboardKpiGroup('law')).toBe('legislative')
    expect(resolveDashboardKpiGroup('royal_decree')).toBe('legislative')
    expect(resolveDashboardKpiGroup('executive_regulation')).toBe('legislative')
    expect(resolveDashboardKpiGroup('regulatory_framework')).toBe('legislative')

    expect(resolveDashboardKpiGroup('ministerial_decision')).toBe('decision')
    expect(resolveDashboardKpiGroup('circular')).toBe('decision')
    expect(resolveDashboardKpiGroup('official_notice')).toBe('decision')

    expect(resolveDashboardKpiGroup('court_precedent')).toBe('case')

    expect(resolveDashboardKpiGroup('other')).toBe('other')
    expect(resolveDashboardKpiGroup('consultation_draft')).toBe('other')
  })

  it('never keys off legal_status or category — a law flagged amended is still legislative, not amendment', () => {
    // resolveDashboardKpiGroup only ever takes document_type at all — the
    // type signature itself proves legal_status/category cannot influence
    // it, but the point of this test is documentation: unlike
    // resolveContentType, this function must never grow that override.
    expect(resolveDashboardKpiGroup('law')).toBe('legislative')
  })

  it('every DocumentType is covered by exactly one KPI group — a true partition, no gaps or overlaps', () => {
    for (const dt of DOCUMENT_TYPES) {
      const matches = DASHBOARD_KPI_GROUP_KEYS.filter((key) => resolveDashboardKpiGroup(dt) === key)
      expect(matches, `document_type=${dt} must resolve to exactly one KPI group`).toHaveLength(1)
    }
    // And the reverse: every group has a label, and the four groups are the whole set.
    expect(DASHBOARD_KPI_GROUP_KEYS).toHaveLength(4)
    for (const key of DASHBOARD_KPI_GROUP_KEYS) {
      expect(DASHBOARD_KPI_GROUP_LABELS_AR[key]).toBeTruthy()
    }
  })

  it('the four groups sum to the total for a mixed batch — the property the KPI strip relies on', () => {
    const rows: Array<{ document_type: (typeof DOCUMENT_TYPES)[number] | null }> = DOCUMENT_TYPES.map((dt) => ({
      document_type: dt,
    }))
    const counts = new Map<string, number>()
    for (const row of rows) {
      const bucket = resolveDashboardKpiGroup(row.document_type)
      counts.set(bucket, (counts.get(bucket) ?? 0) + 1)
    }
    const sum = DASHBOARD_KPI_GROUP_KEYS.reduce((acc, key) => acc + (counts.get(key) ?? 0), 0)
    expect(sum).toBe(rows.length)
  })
})
