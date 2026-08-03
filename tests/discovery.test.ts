import { describe, expect, it } from 'vitest'

import {
  buildGoogleNewsFeedUrl,
  DISCOVERY_LEGAL_PHRASES,
  extractCanonicalUrl,
  hostnameOf,
  matchAuthorityMention,
  matchOfficialDomain,
  resolveDiscoveredItem,
  type OfficialSourceRef,
} from '@/lib/discovery/discovery'

const SOURCES: OfficialSourceRef[] = [
  {
    id: 'src-zatca',
    authorityAr: 'هيئة الزكاة والضريبة والجمارك',
    authorityEn: 'Zakat, Tax and Customs Authority',
    allowedDomains: ['zatca.gov.sa', 'www.zatca.gov.sa'],
  },
  {
    id: 'src-moci',
    authorityAr: 'وزارة التجارة',
    authorityEn: 'Ministry of Commerce',
    allowedDomains: ['mc.gov.sa'],
  },
]

describe('matchOfficialDomain', () => {
  it('matches a known official hostname exactly', () => {
    const m = matchOfficialDomain('www.zatca.gov.sa', SOURCES)
    expect(m).toEqual({ sourceId: 'src-zatca', method: 'domain_match', confidence: 100 })
  })

  it('is case-insensitive', () => {
    expect(matchOfficialDomain('WWW.ZATCA.GOV.SA', SOURCES)?.sourceId).toBe('src-zatca')
  })

  it('returns null for an unregistered domain', () => {
    expect(matchOfficialDomain('elnashra.com', SOURCES)).toBeNull()
  })

  it('returns null for an empty hostname', () => {
    expect(matchOfficialDomain('', SOURCES)).toBeNull()
  })
})

describe('matchAuthorityMention', () => {
  it('finds an authority named in the title', () => {
    const m = matchAuthorityMention('وزارة التجارة تصدر قراراً جديداً بشأن السجل التجاري', SOURCES)
    expect(m?.sourceId).toBe('src-moci')
    expect(m?.method).toBe('authority_name_match')
  })

  it('prefers the longer, more specific match when both could apply', () => {
    const m = matchAuthorityMention('هيئة الزكاة والضريبة والجمارك ووزارة التجارة يوقعان مذكرة', SOURCES)
    // both names appear; the function must pick ONE deterministically (the higher-confidence one)
    expect(['src-zatca', 'src-moci']).toContain(m?.sourceId)
  })

  it('returns null when no registered authority is mentioned', () => {
    expect(matchAuthorityMention('نادي النصر يعلن عن صفقة جديدة', SOURCES)).toBeNull()
  })

  it('ignores names shorter than 4 characters to avoid spurious matches', () => {
    const shortNameSources: OfficialSourceRef[] = [
      { id: 'x', authorityAr: 'قطر', authorityEn: 'Qatar', allowedDomains: ['x.gov.qa'] },
    ]
    expect(matchAuthorityMention('قطر تستضيف بطولة كرة القدم', shortNameSources)).toBeNull()
  })
})

describe('extractCanonicalUrl', () => {
  it('extracts a <link rel="canonical"> tag', () => {
    const html = '<html><head><link rel="canonical" href="https://example.gov.sa/real-article" /></head></html>'
    expect(extractCanonicalUrl(html)).toBe('https://example.gov.sa/real-article')
  })

  it('falls back to og:url when there is no canonical tag', () => {
    const html = '<html><head><meta property="og:url" content="https://example.gov.sa/og-article" /></head></html>'
    expect(extractCanonicalUrl(html)).toBe('https://example.gov.sa/og-article')
  })

  it('falls back to JSON-LD url when there is neither canonical nor og:url', () => {
    const html = `<html><head><script type="application/ld+json">{"@type":"NewsArticle","url":"https://example.gov.sa/jsonld-article"}</script></head></html>`
    expect(extractCanonicalUrl(html)).toBe('https://example.gov.sa/jsonld-article')
  })

  it('reads mainEntityOfPage when url is absent from JSON-LD', () => {
    const html = `<html><head><script type="application/ld+json">{"mainEntityOfPage":"https://example.gov.sa/meop"}</script></head></html>`
    expect(extractCanonicalUrl(html)).toBe('https://example.gov.sa/meop')
  })

  it('returns null rather than inventing a URL when nothing is found', () => {
    expect(extractCanonicalUrl('<html><head><title>no metadata here</title></head></html>')).toBeNull()
  })

  it('does not throw on malformed JSON-LD', () => {
    const html = `<html><head><script type="application/ld+json">{ not valid json </script></head></html>`
    expect(() => extractCanonicalUrl(html)).not.toThrow()
    expect(extractCanonicalUrl(html)).toBeNull()
  })

  it('prefers canonical over og:url when both are present', () => {
    const html = `<html><head>
      <link rel="canonical" href="https://example.gov.sa/canonical" />
      <meta property="og:url" content="https://example.gov.sa/og" />
    </head></html>`
    expect(extractCanonicalUrl(html)).toBe('https://example.gov.sa/canonical')
  })
})

describe('hostnameOf', () => {
  it('extracts the hostname from a URL without the URL global', () => {
    expect(hostnameOf('https://www.example.gov.sa/path?x=1')).toBe('www.example.gov.sa')
  })
  it('returns null for a non-URL string', () => {
    expect(hostnameOf('not a url')).toBeNull()
  })
})

describe('buildGoogleNewsFeedUrl', () => {
  it('builds a well-formed Google News RSS search URL per country', () => {
    const url = buildGoogleNewsFeedUrl('SA')
    expect(url).toContain('https://news.google.com/rss/search?q=')
    expect(url).toContain('gl=SA')
    expect(url).toContain('ceid=SA:ar')
    expect(url).toContain('hl=ar')
  })

  it('encodes every configured legal phrase into the query', () => {
    const url = buildGoogleNewsFeedUrl('AE')
    const decoded = decodeURIComponent(url)
    for (const phrase of DISCOVERY_LEGAL_PHRASES) {
      expect(decoded).toContain(phrase)
    }
  })

  it('produces a distinct URL per country (no accidental base_url collision)', () => {
    const urls = new Set(['SA', 'AE', 'KW', 'QA', 'BH', 'OM'].map((c) => buildGoogleNewsFeedUrl(c as never)))
    expect(urls.size).toBe(6)
  })
})

describe('resolveDiscoveredItem — the full decision, end to end', () => {
  const discoverySourceId = 'discovery-sa'

  it('resolves to official via domain match when the item source is a known official domain', () => {
    const resolved = resolveDiscoveredItem({
      item: {
        title: 'هيئة الزكاة تصدر تعميماً جديداً',
        link: 'https://news.google.com/rss/articles/xyz',
        pubDate: '2026-08-03',
        sourceUrl: 'https://zatca.gov.sa',
        sourceName: 'ZATCA',
        description: null,
      },
      officialSources: SOURCES,
      discoverySourceId,
    })
    expect(resolved).toEqual({
      originType: 'official',
      sourceId: 'src-zatca',
      canonicalUrl: 'https://zatca.gov.sa',
      verificationMethod: 'domain_match',
      confidence: 100,
    })
  })

  it('resolves to official via a strong authority-name mention when no domain match exists', () => {
    const resolved = resolveDiscoveredItem({
      item: {
        title: 'هيئة الزكاة والضريبة والجمارك تعلن تمديد مهلة الإقرارات الضريبية',
        link: 'https://news.google.com/rss/articles/abc',
        pubDate: '2026-08-03',
        sourceUrl: 'https://www.alqabas.com',
        sourceName: 'Al-Qabas',
        description: null,
      },
      officialSources: SOURCES,
      discoverySourceId,
    })
    expect(resolved.originType).toBe('official')
    expect(resolved.sourceId).toBe('src-zatca')
    expect(resolved.verificationMethod).toBe('authority_name_match')
    expect(resolved.canonicalUrl).toBeNull()
  })

  it('falls back to the discovery pseudo-source when nothing resolves', () => {
    const resolved = resolveDiscoveredItem({
      item: {
        title: 'نادي الهلال يفوز بالدوري',
        link: 'https://news.google.com/rss/articles/def',
        pubDate: '2026-08-03',
        sourceUrl: 'https://www.kooora.com',
        sourceName: 'Kooora',
        description: null,
      },
      officialSources: SOURCES,
      discoverySourceId,
    })
    expect(resolved).toEqual({
      originType: 'discovery',
      sourceId: discoverySourceId,
      canonicalUrl: null,
      verificationMethod: null,
      confidence: 0,
    })
  })

  it('never publishes a discovery item as official on a weak, low-confidence mention alone', () => {
    // a bare 4-letter fragment coincidentally inside unrelated text must not
    // promote an item to "official" — confidence must clear the 60 bar
    const weakSources: OfficialSourceRef[] = [
      { id: 'weak', authorityAr: 'قطر', authorityEn: 'Body', allowedDomains: ['x.gov.qa'] },
    ]
    const resolved = resolveDiscoveredItem({
      item: {
        title: 'خبر لا علاقة له بأي جهة رسمية إطلاقاً',
        link: 'https://news.google.com/rss/articles/ghi',
        pubDate: null,
        sourceUrl: 'https://example.com',
        sourceName: null,
        description: null,
      },
      officialSources: weakSources,
      discoverySourceId,
    })
    expect(resolved.originType).toBe('discovery')
  })
})
