import { describe, expect, it } from 'vitest'

import {
  CONTENT_TYPE_KEYS,
  contentTypeOrExpr,
  resolveContentType,
} from '@/lib/constants/content-type'

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
