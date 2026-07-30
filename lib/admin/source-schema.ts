import { z } from 'zod'

import { COUNTRY_CODES } from '@/lib/constants/countries'
import { PARSER_TYPES, SOURCE_TYPES } from '@/lib/constants/taxonomy'

/**
 * Source form validation.
 *
 * Mirrors every CHECK constraint in migrations 0003, 0008 and 0011 so an admin
 * gets a specific Arabic message instead of a raw constraint violation. The
 * database remains the enforcement point — this layer exists for the message,
 * not for the guarantee, and must never be the only thing standing between bad
 * input and the table.
 */

const HOSTNAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/

/** Parser types an admin may choose. 'unknown' is set by the system, not picked. */
export const SELECTABLE_PARSER_TYPES = PARSER_TYPES.filter((p) => p !== 'unknown')

/**
 * `parser_config` describes WHERE to read: selectors and field paths. Decision
 * logic — thresholds, retries, publish rules — belongs to n8n. Registry check
 * S15 fails the build if any of these leak in, so the same list is rejected
 * here at the point of entry.
 */
const WORKFLOW_LOGIC_KEY =
  /(threshold|confidence|publish|retry|backoff|schedule|cron|enabled|filter|rule)/i

export function hostnameOfUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
    return parsed.hostname.toLowerCase()
  } catch {
    return null
  }
}

const httpUrl = z
  .string()
  .trim()
  .min(1, { error: 'الرابط مطلوب' })
  .refine((v) => hostnameOfUrl(v) !== null, { error: 'يجب أن يكون رابطاً صالحاً يبدأ بـ http أو https' })

const domainList = z
  .string()
  .transform((raw) =>
    [
      ...new Set(
        raw
          .split(/[\n,]/)
          .map((d) => d.trim().toLowerCase())
          .filter((d) => d.length > 0),
      ),
    ],
  )
  .refine((list) => list.length > 0, { error: 'يجب إدخال نطاق موثوق واحد على الأقل' })
  .refine((list) => list.every((d) => HOSTNAME.test(d)), {
    error: 'أدخل أسماء مضيفين فقط بحروف صغيرة، بدون بروتوكول أو مسار (مثال: moj.gov.sa)',
  })

/** Parsed and validated JSON object, or `{}` when the field is left blank. */
const parserConfig = z
  .string()
  .transform((raw) => raw.trim())
  .superRefine((raw, ctx) => {
    if (raw === '') return
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      ctx.addIssue({ code: 'custom', message: 'إعدادات المحلّل ليست JSON صالحاً' })
      return
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      ctx.addIssue({ code: 'custom', message: 'يجب أن تكون إعدادات المحلّل كائن JSON' })
      return
    }
    const offending = Object.keys(parsed as object).filter((k) => WORKFLOW_LOGIC_KEY.test(k))
    if (offending.length > 0) {
      ctx.addIssue({
        code: 'custom',
        message: `منطق سير العمل لا يُخزَّن هنا. أزل المفاتيح: ${offending.join('، ')}`,
      })
    }
  })
  .transform((raw) => (raw === '' ? {} : (JSON.parse(raw) as Record<string, unknown>)))

export const sourceFormSchema = z
  .object({
    country: z.enum(COUNTRY_CODES),
    authority_ar: z.string().trim().min(2, { error: 'اسم الجهة بالعربية مطلوب' }).max(200),
    authority_en: z.string().trim().min(2, { error: 'اسم الجهة بالإنجليزية مطلوب' }).max(200),
    source_type: z.enum(SOURCE_TYPES),
    base_url: httpUrl,
    feed_url: z
      .string()
      .trim()
      .transform((v) => (v === '' ? null : v))
      .refine((v) => v === null || hostnameOfUrl(v) !== null, {
        error: 'رابط التغذية غير صالح',
      }),
    parser_type: z.enum(PARSER_TYPES),
    parser_config: parserConfig,
    allowed_domains: domainList,
    priority: z.coerce.number().int().min(1).max(5),
    poll_interval_minutes: z
      .string()
      .trim()
      .transform((v) => (v === '' ? null : Number(v)))
      .refine((v) => v === null || (Number.isInteger(v) && v > 0), {
        error: 'فترة الاستطلاع يجب أن تكون عدداً صحيحاً موجباً',
      }),
    notes: z.string().trim().max(2000).optional(),
    exclusion_group: z
      .string()
      .trim()
      .transform((v) => (v === '' ? null : v))
      .refine((v) => v === null || /^[a-z0-9-]{2,50}$/.test(v), {
        error: 'مجموعة الاستبعاد: حروف صغيرة وأرقام وشرطات فقط',
      }),
    requires_authority_check: z.boolean(),
  })
  // Mirrors sources_base_url_domain_trusted.
  .refine(
    (v) => {
      const host = hostnameOfUrl(v.base_url)
      return host !== null && v.allowed_domains.includes(host)
    },
    {
      error: 'يجب أن يكون مضيف الرابط الأساسي ضمن النطاقات الموثوقة',
      path: ['allowed_domains'],
    },
  )
  // Mirrors sources_feed_url_domain_trusted.
  .refine(
    (v) => {
      if (!v.feed_url) return true
      const host = hostnameOfUrl(v.feed_url)
      return host !== null && v.allowed_domains.includes(host)
    },
    {
      error: 'يجب أن يكون مضيف رابط التغذية ضمن النطاقات الموثوقة',
      path: ['allowed_domains'],
    },
  )
  // Mirrors sources_feed_required.
  .refine((v) => !(v.parser_type === 'rss' || v.parser_type === 'api') || v.feed_url !== null, {
    error: 'محلّل RSS أو API يتطلب رابط تغذية',
    path: ['feed_url'],
  })

export type SourceFormValues = z.infer<typeof sourceFormSchema>

/**
 * Whether a source is configured well enough to be marked verified.
 *
 * Mirrors sources_verified_has_parser and sources_verified_html_pdf_config, so
 * the UI can explain what is still missing instead of letting the admin submit
 * and receive a constraint violation.
 */
export function verificationBlockers(values: {
  parser_type: string
  parser_config: Record<string, unknown>
  feed_url: string | null
}): string[] {
  const blockers: string[] = []

  if (values.parser_type === 'unknown') {
    blockers.push('لم يُحدَّد نوع المحلّل بعد')
  }
  if (
    (values.parser_type === 'html' || values.parser_type === 'pdf') &&
    Object.keys(values.parser_config).length === 0
  ) {
    blockers.push('محلّل HTML أو PDF يتطلب مُحدِّدات في إعدادات المحلّل')
  }
  if ((values.parser_type === 'rss' || values.parser_type === 'api') && !values.feed_url) {
    blockers.push('محلّل RSS أو API يتطلب رابط تغذية')
  }

  return blockers
}

/**
 * Empty scaffolds offered in the UI as a starting point.
 *
 * The VALUES are intentionally blank. Pre-filling plausible selectors would be
 * guessing, and a guessed selector that happens to match something produces an
 * archive full of confidently wrong content attributed to a real ministry.
 * These show the expected SHAPE only.
 */
export const PARSER_CONFIG_TEMPLATES: Readonly<Record<string, string>> = {
  rss: JSON.stringify({ date_field: '', content_field: '' }, null, 2),
  api: JSON.stringify(
    { items_path: '', title: '', url: '', date: '', body: '', headers: {} },
    null,
    2,
  ),
  html: JSON.stringify({ list: '', title: '', link: '', date: '', body: '' }, null, 2),
  pdf: JSON.stringify({ list: '', max_pages: 40 }, null, 2),
  unknown: '{}',
}
