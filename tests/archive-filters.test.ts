import { describe, expect, it } from 'vitest'

import {
  buildArchiveQuery,
  hasActiveFilters,
  MAX_PAGE,
  MAX_PAGE_SIZE,
  PAGE_SIZE,
  parseArchiveFilters,
  type RawSearchParams,
} from '@/lib/updates/filters'

function parse(raw: RawSearchParams) {
  return parseArchiveFilters(raw)
}

describe('enum filters', () => {
  it('accepts repeated parameters and comma-separated lists alike', () => {
    expect(parse({ country: ['SA', 'AE'] }).country).toEqual(['SA', 'AE'])
    expect(parse({ country: 'SA,AE' }).country).toEqual(['SA', 'AE'])
  })

  it('silently drops values outside the enum', () => {
    // A stale bookmark should show the archive, not an error page.
    expect(parse({ country: 'SA,ZZ,XX' }).country).toEqual(['SA'])
    expect(parse({ category: 'nonsense' }).category).toEqual([])
  })

  it('de-duplicates', () => {
    expect(parse({ country: 'SA,SA,SA' }).country).toEqual(['SA'])
  })

  it('ignores injection-shaped values instead of passing them on', () => {
    expect(parse({ country: "SA';drop table legal_updates;--" }).country).toEqual([])
    expect(parse({ category: '*' }).category).toEqual([])
  })
})

describe('source filter', () => {
  it('accepts a well-formed uuid', () => {
    const id = '3f1e8a2b-0c4d-4e6f-8a90-1b2c3d4e5f60'
    expect(parse({ source: id }).source).toBe(id)
  })

  it('rejects anything that is not a uuid', () => {
    expect(parse({ source: 'not-a-uuid' }).source).toBeUndefined()
    expect(parse({ source: '1 OR 1=1' }).source).toBeUndefined()
  })
})

describe('date ranges', () => {
  it('accepts ISO dates', () => {
    const f = parse({ publishedFrom: '2026-01-01', publishedTo: '2026-12-31' })
    expect(f.publishedFrom).toBe('2026-01-01')
    expect(f.publishedTo).toBe('2026-12-31')
  })

  it('rejects malformed dates', () => {
    expect(parse({ publishedFrom: '01/01/2026' }).publishedFrom).toBeUndefined()
    expect(parse({ publishedFrom: 'yesterday' }).publishedFrom).toBeUndefined()
    expect(parse({ publishedFrom: '2026-1-1' }).publishedFrom).toBeUndefined()
  })

  it('rejects dates that match the shape but do not exist', () => {
    // 2026 is not a leap year, and February never has 31 days.
    expect(parse({ publishedFrom: '2026-02-30' }).publishedFrom).toBeUndefined()
    expect(parse({ publishedFrom: '2026-13-01' }).publishedFrom).toBeUndefined()
    expect(parse({ publishedFrom: '2026-00-10' }).publishedFrom).toBeUndefined()
  })

  it('swaps an inverted range rather than returning nothing', () => {
    const f = parse({ publishedFrom: '2026-12-31', publishedTo: '2026-01-01' })
    expect(f.publishedFrom).toBe('2026-01-01')
    expect(f.publishedTo).toBe('2026-12-31')
  })
})

describe('search term', () => {
  it('trims', () => {
    expect(parse({ q: '  ضريبة  ' }).q).toBe('ضريبة')
  })

  it('discards a pasted document', () => {
    expect(parse({ q: 'x'.repeat(5000) }).q).toBe('')
  })

  it('treats whitespace-only as absent', () => {
    expect(parse({ q: '   ' }).q).toBe('')
  })
})

describe('pagination boundaries', () => {
  it('defaults to page 1 at the standard size', () => {
    const f = parse({})
    expect(f.page).toBe(1)
    expect(f.pageSize).toBe(PAGE_SIZE)
  })

  it('clamps a page below 1', () => {
    expect(parse({ page: '0' }).page).toBe(1)
    expect(parse({ page: '-5' }).page).toBe(1)
  })

  it('caps the page number so a hand-typed offset cannot force a huge scan', () => {
    expect(parse({ page: '999999' }).page).toBe(MAX_PAGE)
  })

  it('falls back to page 1 for non-numeric input', () => {
    expect(parse({ page: 'abc' }).page).toBe(1)
    expect(parse({ page: '1.5' }).page).toBe(1)
    expect(parse({ page: 'Infinity' }).page).toBe(1)
  })

  it('caps page size', () => {
    expect(parse({ pageSize: '10000' }).pageSize).toBe(MAX_PAGE_SIZE)
    expect(parse({ pageSize: '0' }).pageSize).toBe(PAGE_SIZE)
    expect(parse({ pageSize: '-1' }).pageSize).toBe(PAGE_SIZE)
  })

  it('accepts a valid custom page size', () => {
    expect(parse({ pageSize: '5' }).pageSize).toBe(5)
  })
})

describe('active-filter detection', () => {
  it('is false for a bare request', () => {
    expect(hasActiveFilters(parse({}))).toBe(false)
  })

  it('is false when every parameter was rejected', () => {
    // Junk in the URL must not make the UI claim results are filtered.
    expect(hasActiveFilters(parse({ country: 'ZZ', publishedFrom: 'bad' }))).toBe(false)
  })

  it('is true when anything narrows the archive', () => {
    expect(hasActiveFilters(parse({ q: 'ضريبة' }))).toBe(true)
    expect(hasActiveFilters(parse({ country: 'SA' }))).toBe(true)
  })

  it('ignores pagination — page 2 is not a filter', () => {
    expect(hasActiveFilters(parse({ page: '2' }))).toBe(false)
  })
})

describe('query string round-trip', () => {
  it('reproduces the parsed state', () => {
    const f = parse({ q: 'ضريبة', country: 'SA,AE', page: '3' })
    const qs = buildArchiveQuery(f)
    const reparsed = parse(Object.fromEntries(new URLSearchParams(qs).entries()))
    expect(reparsed.q).toBe('ضريبة')
    expect(reparsed.page).toBe(3)
  })

  it('drops rejected parameters rather than carrying them forward', () => {
    const qs = buildArchiveQuery(parse({ country: 'ZZ', q: 'ضريبة' }))
    expect(qs).not.toContain('ZZ')
    expect(qs).toContain('q=')
  })

  it('omits page 1 and the default page size to keep URLs clean', () => {
    expect(buildArchiveQuery(parse({ q: 'x' }))).toBe('?q=x')
  })

  it('returns an empty string when nothing is set', () => {
    expect(buildArchiveQuery(parse({}))).toBe('')
  })

  it('overrides the page for pagination links', () => {
    const f = parse({ q: 'ضريبة' })
    expect(buildArchiveQuery(f, { page: 4 })).toContain('page=4')
  })

  it('preserves multi-valued filters', () => {
    const f = parse({ country: 'SA,AE,KW' })
    const qs = buildArchiveQuery(f)
    expect(new URLSearchParams(qs).getAll('country')).toEqual(['SA', 'AE', 'KW'])
  })
})

describe('malformed input never throws', () => {
  it('collapses a repeated scalar parameter to its first value', () => {
    // ?page=2&page=9 is a legal URL and Next surfaces it as an array.
    expect(parse({ page: ['2', '9'] }).page).toBe(2)
    expect(parse({ q: ['ضريبة', 'ignored'] }).q).toBe('ضريبة')
    expect(parse({ page: [] }).page).toBe(1)
  })

  it('survives every junk shape a URL can produce', () => {
    const junk: RawSearchParams[] = [
      { page: ['1', '2'] },      // repeated scalar → first value wins
      { page: [] },              // empty array → default
      { q: ['a', 'b'] },
      { q: [] },
      { country: [''] },
      { publishedFrom: '', publishedTo: '' },
      { pageSize: '1e10' },
      { source: '../../etc/passwd' },
    ]
    for (const raw of junk) {
      expect(() => parse(raw)).not.toThrow()
    }
  })
})
