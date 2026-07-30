import { describe, expect, it } from 'vitest'

import {
  escapeLikePattern,
  MIN_FUZZY_LENGTH,
  normalizeArabic,
  normalizeSearchQuery,
} from '@/lib/search/arabic'

/**
 * These assert the TypeScript side of the normalisation contract.
 *
 * They do NOT prove parity with Postgres — a test can only check the code
 * against expectations someone wrote down, and the expectation itself could be
 * wrong. scripts/verify-normalization-parity.mjs runs both implementations over
 * a shared corpus and diffs them; it is part of `npm run db:check`.
 */

describe('hamza folding', () => {
  it('folds every alef variant to bare alef', () => {
    expect(normalizeArabic('أ')).toBe('ا') // hamza above
    expect(normalizeArabic('إ')).toBe('ا') // hamza below
    expect(normalizeArabic('آ')).toBe('ا') // madda
    expect(normalizeArabic('ٱ')).toBe('ا') // wasla
  })

  it('folds hamza carriers on waw and yeh', () => {
    expect(normalizeArabic('ؤ')).toBe('و')
    expect(normalizeArabic('ئ')).toBe('ي')
  })

  it('makes the two spellings of أحكام converge', () => {
    expect(normalizeArabic('أحكام')).toBe(normalizeArabic('احكام'))
  })
})

describe('teh marbuta and alef maksura', () => {
  it('folds ة to ه', () => {
    expect(normalizeArabic('ة')).toBe('ه')
    expect(normalizeArabic('اللائحة')).toBe(normalizeArabic('اللائحه'))
  })

  it('folds ى to ي', () => {
    expect(normalizeArabic('ى')).toBe('ي')
    expect(normalizeArabic('على')).toBe(normalizeArabic('علي'))
  })

  it('makes ضريبة and ضريبه the same search term', () => {
    // The exact case that motivated the whole contract.
    expect(normalizeArabic('ضريبة')).toBe(normalizeArabic('ضريبه'))
  })
})

describe('diacritic stripping', () => {
  it('removes every tashkeel mark', () => {
    for (const mark of ['ً', 'ٌ', 'ٍ', 'َ', 'ُ', 'ِ', 'ّ', 'ْ', 'ٰ']) {
      expect(normalizeArabic(mark)).toBe('')
    }
  })

  it('removes tatweel', () => {
    expect(normalizeArabic('نظــــام')).toBe('نظام')
  })

  it('makes fully vocalised text match its plain spelling', () => {
    expect(normalizeArabic('مَرْسُومٌ مَلَكِيٌّ')).toBe('مرسوم ملكي')
    expect(normalizeArabic('أَحْكَام')).toBe('احكام')
    expect(normalizeArabic('هَيْئَة')).toBe(normalizeArabic('هيئة'))
  })
})

describe('non-Arabic input is left alone', () => {
  it('passes Latin text through unchanged', () => {
    expect(normalizeArabic('VAT regulation 2026')).toBe('VAT regulation 2026')
  })

  it('preserves digits and punctuation', () => {
    expect(normalizeArabic('15% — (12)')).toBe('15% — (12)')
  })

  it('does not corrupt surrogate pairs', () => {
    // Iterating by code unit rather than code point would split this in half.
    const flag = '🇸🇦'
    expect(normalizeArabic(`${flag} قرار`)).toBe(`${flag} قرار`)
    expect([...normalizeArabic(flag)]).toHaveLength([...flag].length)
  })

  it('handles empty input', () => {
    expect(normalizeArabic('')).toBe('')
  })
})

describe('search query preparation', () => {
  it('normalises, collapses whitespace and trims', () => {
    expect(normalizeSearchQuery('  ضريبة    القيمة  ')).toBe('ضريبه القيمه')
  })

  it('collapses newlines and tabs', () => {
    expect(normalizeSearchQuery('ضريبة\n\tالقيمة')).toBe('ضريبه القيمه')
  })

  it('returns empty for whitespace-only input', () => {
    expect(normalizeSearchQuery('     ')).toBe('')
  })

  it('leaves tsquery operator characters as literal text', () => {
    /*
     * The query goes to plainto_tsquery, which treats input as literal terms.
     * Normalisation must not strip or interpret these — they are searched for,
     * not executed, so a user cannot steer the query from the search box.
     */
    expect(normalizeSearchQuery('ضريبة & القيمة')).toContain('&')
    expect(normalizeSearchQuery('a | b')).toBe('a | b')
    expect(normalizeSearchQuery('!term')).toBe('!term')
    expect(normalizeSearchQuery("';drop table--")).toBe("';drop table--")
  })
})

describe('LIKE pattern escaping for the trigram fallback', () => {
  it('escapes the wildcard characters', () => {
    expect(escapeLikePattern('100%')).toBe('100\\%')
    expect(escapeLikePattern('a_b')).toBe('a\\_b')
  })

  it('escapes backslashes so an escape cannot be smuggled in', () => {
    expect(escapeLikePattern('a\\b')).toBe('a\\\\b')
  })

  it('neutralises a match-everything pattern', () => {
    // Unescaped, '%' alone would return the entire archive.
    expect(escapeLikePattern('%')).toBe('\\%')
  })

  it('leaves ordinary Arabic untouched', () => {
    expect(escapeLikePattern('ضريبة القيمة')).toBe('ضريبة القيمة')
  })

  it('has a sensible fuzzy threshold', () => {
    expect(MIN_FUZZY_LENGTH).toBeGreaterThanOrEqual(3)
  })
})
