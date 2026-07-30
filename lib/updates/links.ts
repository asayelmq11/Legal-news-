/**
 * External source-link safety.
 *
 * Every archived item carries a `source_url` written by n8n. The Publishing
 * Gate already checks that the host is in the source's `allowed_domains` before
 * inserting, so a mismatch here should be impossible — but the archive is
 * long-lived, and a source's domain list can be edited by an admin *after* rows
 * exist. That means a historical row can drift out of its own allow-list.
 *
 * Rather than trust the stored URL, the link is re-validated at render time
 * against the source it claims to come from. A lawyer following a link from
 * this platform must land on the authority, not wherever the string happens to
 * point.
 */

export type LinkVerdict =
  | { safe: true; href: string; hostname: string }
  | { safe: false; reason: LinkRejection; hostname: string | null }

export type LinkRejection =
  | 'malformed' // not a parseable absolute URL
  | 'unsupported_scheme' // not http/https — blocks javascript:, data:, file:
  | 'domain_not_trusted' // host is absent from the source's allow-list
  | 'missing' // no URL recorded at all

/**
 * Validates an archived URL against the allow-list of the source it belongs to.
 *
 * Matching is exact on hostname, mirroring the database constraint: `gov.sa`
 * does NOT authorise `evil-gov.sa`, and a parent domain does not authorise a
 * subdomain. Both must be listed explicitly if both are used.
 */
export function verifySourceLink(
  url: string | null | undefined,
  allowedDomains: readonly string[] | null | undefined,
): LinkVerdict {
  if (!url || url.trim() === '') {
    return { safe: false, reason: 'missing', hostname: null }
  }

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { safe: false, reason: 'malformed', hostname: null }
  }

  // Anything other than http(s) is refused outright. `javascript:` in an href
  // executes on click; `data:` can render attacker-controlled markup.
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { safe: false, reason: 'unsupported_scheme', hostname: null }
  }

  const hostname = parsed.hostname.toLowerCase()
  const allowed = (allowedDomains ?? []).map((d) => d.trim().toLowerCase())

  if (allowed.length === 0 || !allowed.includes(hostname)) {
    return { safe: false, reason: 'domain_not_trusted', hostname }
  }

  return { safe: true, href: parsed.toString(), hostname }
}

export const LINK_REJECTION_LABELS_AR: Readonly<Record<LinkRejection, string>> = {
  missing: 'لم يُسجَّل رابط للمصدر الأصلي.',
  malformed: 'رابط المصدر المسجَّل غير صالح.',
  unsupported_scheme: 'رابط المصدر يستخدم بروتوكولاً غير مدعوم.',
  domain_not_trusted:
    'نطاق الرابط لا يطابق النطاقات المعتمدة لهذا المصدر. تم تعطيل الرابط احترازاً.',
}
