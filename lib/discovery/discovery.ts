/**
 * Hybrid discovery layer — canonical resolution and official-source matching.
 *
 * The 52-source registry proved that a dedicated, hand-derived parser per
 * authority does not scale: most GCC portals sit behind a WAF, run a legacy
 * stack with no feed, or are simply unreachable from n8n's egress (see
 * docs/source-provisioning-2026-08-02.md). Discovery engines (Google News
 * today) are NOT publishing sources — they surface that something happened.
 * Everything found here still passes through the same AI classification and
 * Publishing Gate as an official crawl before it can ever reach
 * `legal_updates`; this module only decides what to call the origin and,
 * where possible, which registered official source it actually belongs to.
 *
 * n8n's Discovery Ingestion workflow (05) mirrors this logic in a Code node
 * — the same relationship retry.ts/health.ts/dispatch.ts already have with
 * their nodes, because a Code node cannot `import` this file.
 */

/** A source's identity as far as domain/name matching needs it. */
export interface OfficialSourceRef {
  id: string
  authorityAr: string
  authorityEn: string
  allowedDomains: readonly string[]
}

export interface DomainMatch {
  sourceId: string
  method: 'domain_match'
  confidence: 100
}

/**
 * Exact match: the resolved domain is a known official source's own
 * allow-listed hostname. This is the strong case — the discovery engine
 * happened to surface the authority's own domain directly (e.g. a ministry's
 * newsroom is itself aggregated by Google News).
 */
export function matchOfficialDomain(
  hostname: string,
  sources: readonly OfficialSourceRef[],
): DomainMatch | null {
  const host = hostname.trim().toLowerCase()
  if (!host) return null
  const hit = sources.find((s) => s.allowedDomains.some((d) => d.toLowerCase() === host))
  return hit ? { sourceId: hit.id, method: 'domain_match', confidence: 100 } : null
}

export interface AuthorityMatch {
  sourceId: string
  method: 'authority_name_match'
  confidence: number
  matchedName: string
}

/**
 * Weak match: the discovered item's title mentions a registered authority by
 * name. This is a hint, not a confirmation — it says "this article is ABOUT
 * that ministry," not "this article IS that ministry's own publication."
 * Confidence is capped well below a domain match and the caller decides
 * whether that is high enough to record as `canonical_url`'s source_id or
 * merely as a suggestion.
 *
 * Only names of 4+ characters are matched, to avoid a short acronym or
 * common word spuriously matching unrelated text.
 */
export function matchAuthorityMention(
  title: string,
  sources: readonly OfficialSourceRef[],
): AuthorityMatch | null {
  const text = title.trim()
  if (!text) return null

  let best: AuthorityMatch | null = null
  for (const s of sources) {
    for (const name of [s.authorityAr, s.authorityEn]) {
      const candidate = name.trim()
      if (candidate.length < 4) continue
      if (!text.includes(candidate)) continue
      // Longer matched names are less likely to be coincidental.
      const confidence = Math.min(95, 40 + candidate.length)
      if (!best || confidence > best.confidence) {
        best = { sourceId: s.id, method: 'authority_name_match', confidence, matchedName: candidate }
      }
    }
  }
  return best
}

/**
 * Canonical URL extraction from a fetched page's HTML — general-purpose,
 * not specific to any one discovery engine. Tries, in order: the `canonical`
 * link tag, `og:url`, then JSON-LD `url`/`mainEntityOfPage`. Returns null
 * rather than the page's own request URL when nothing is found — the caller
 * decides the fallback, so this function never silently invents a URL.
 *
 * KNOWN LIMITATION, documented rather than worked around: Google News RSS
 * `<link>` values are not fetchable pages at all — they resolve through a
 * client-side JS shell with no server-rendered redirect target. This
 * function is not used against those links; Google News candidates are
 * identified via the RSS `<source url>` tag instead (see
 * `googleNewsSourceDomain`).
 */
export function extractCanonicalUrl(html: string): string | null {
  const canonicalTag = html.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)
  if (canonicalTag?.[1]) return canonicalTag[1]

  const ogUrl = html.match(/<meta[^>]+property=["']og:url["'][^>]*content=["']([^"']+)["']/i)
  if (ogUrl?.[1]) return ogUrl[1]

  const jsonLdBlocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
  for (const block of jsonLdBlocks) {
    try {
      const data: unknown = JSON.parse(block[1] ?? '')
      const url = extractJsonLdUrl(data)
      if (url) return url
    } catch {
      // malformed JSON-LD is common in the wild; skip, don't throw
    }
  }
  return null
}

function extractJsonLdUrl(data: unknown): string | null {
  if (Array.isArray(data)) {
    for (const entry of data) {
      const url = extractJsonLdUrl(entry)
      if (url) return url
    }
    return null
  }
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>
    if (typeof obj.url === 'string') return obj.url
    if (typeof obj.mainEntityOfPage === 'string') return obj.mainEntityOfPage
    if (obj.mainEntityOfPage && typeof obj.mainEntityOfPage === 'object') {
      const nested = (obj.mainEntityOfPage as Record<string, unknown>)['@id']
      if (typeof nested === 'string') return nested
    }
  }
  return null
}

/** Extracts the hostname from a URL without the `URL` global (unavailable in n8n Code nodes). */
export function hostnameOf(url: string): string | null {
  const m = url.match(/^https?:\/\/([^/:?#]+)/i)
  return m?.[1]?.toLowerCase() ?? null
}

export const GCC_COUNTRY_CODES = ['SA', 'AE', 'KW', 'QA', 'BH', 'OM'] as const
export type GccCountryCode = (typeof GCC_COUNTRY_CODES)[number]

/** The exact legal-action phrases the discovery query looks for, in Arabic. */
export const DISCOVERY_LEGAL_PHRASES = [
  'قرار وزاري',
  'قرار مجلس الوزراء',
  'لائحة تنفيذية',
  'مرسوم',
  'تعميم',
  'الجريدة الرسمية',
  'مجلس الوزراء',
  'مشروع قانون',
] as const

const COUNTRY_NAMES_AR: Record<GccCountryCode, string> = {
  SA: 'السعودية',
  AE: 'الإمارات',
  KW: 'الكويت',
  QA: 'قطر',
  BH: 'البحرين',
  OM: 'عمان',
}

/**
 * Builds a Google News RSS search URL scoped to a GCC country. `when` is the
 * freshness window Google News understands (e.g. '2d', '1d') — kept short
 * because the source polls every 2 hours and relies on content_hash /
 * fuzzy-duplicate checks downstream, not this window, for correctness.
 */
export function buildGoogleNewsFeedUrl(country: GccCountryCode, when = '2d'): string {
  const clause = DISCOVERY_LEGAL_PHRASES.map((p) => `"${p}"`).join(' OR ')
  const q = `(${clause}) ${COUNTRY_NAMES_AR[country]} when:${when}`
  const query = encodeURIComponent(q)
  return `https://news.google.com/rss/search?q=${query}&hl=ar&gl=${country}&ceid=${country}:ar`
}

/** One item as it appears in a Google News RSS response, before resolution. */
export interface GoogleNewsItem {
  title: string
  link: string
  pubDate: string | null
  sourceUrl: string | null
  sourceName: string | null
  description: string | null
}

export interface ResolvedDiscoveryItem {
  originType: 'official' | 'discovery'
  sourceId: string
  canonicalUrl: string | null
  verificationMethod: 'domain_match' | 'authority_name_match' | null
  confidence: number
}

/**
 * The full resolution decision for one discovered item, given what could be
 * established about it. `discoverySourceId` is the discovery pseudo-source's
 * own id — the fallback when neither domain nor authority-name matching
 * finds a better, more specific official source.
 */
export function resolveDiscoveredItem(params: {
  item: GoogleNewsItem
  officialSources: readonly OfficialSourceRef[]
  discoverySourceId: string
}): ResolvedDiscoveryItem {
  const { item, officialSources, discoverySourceId } = params

  const domainHit = item.sourceUrl ? matchOfficialDomain(hostnameOf(item.sourceUrl) ?? '', officialSources) : null
  if (domainHit) {
    return {
      originType: 'official',
      sourceId: domainHit.sourceId,
      canonicalUrl: item.sourceUrl,
      verificationMethod: 'domain_match',
      confidence: domainHit.confidence,
    }
  }

  // Only trust a name mention as "official" above a reasonably high bar —
  // below it, still keep the item (discovery is allowed to be uncertain),
  // just don't claim it as a specific authority's own publication.
  const nameHit = matchAuthorityMention(item.title, officialSources)
  if (nameHit && nameHit.confidence >= 60) {
    return {
      originType: 'official',
      sourceId: nameHit.sourceId,
      canonicalUrl: null,
      verificationMethod: 'authority_name_match',
      confidence: nameHit.confidence,
    }
  }

  return {
    originType: 'discovery',
    sourceId: discoverySourceId,
    canonicalUrl: null,
    verificationMethod: null,
    confidence: nameHit?.confidence ?? 0,
  }
}
