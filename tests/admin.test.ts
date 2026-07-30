import { describe, expect, it } from 'vitest'

import {
  isCredentialShapedKey,
  isKnownSettingKey,
  parseSettingValue,
  resolveSetting,
  SETTING_DEFINITIONS,
} from '@/lib/settings/registry'
import {
  hostnameOfUrl,
  sourceFormSchema,
  verificationBlockers,
  PARSER_CONFIG_TEMPLATES,
} from '@/lib/admin/source-schema'
import { canActivate } from '@/lib/sources/status'

/* -------------------------------------------------------------------------- */
/* Settings registry                                                           */
/* -------------------------------------------------------------------------- */

describe('settings registry is a closed allow-list', () => {
  it('recognises exactly the ten declared keys', () => {
    expect(SETTING_DEFINITIONS).toHaveLength(10)
    expect(isKnownSettingKey('ai.confidence_threshold')).toBe(true)
    expect(isKnownSettingKey('newsletter.recipients')).toBe(true)
  })

  it('rejects an unknown key', () => {
    expect(isKnownSettingKey('rogue.key')).toBe(false)
    const result = parseSettingValue('rogue.key', 'anything')
    expect(result.ok).toBe(false)
  })

  it('rejects credential-shaped keys', () => {
    for (const key of [
      'ai.api_key',
      'mail.password',
      'n8n.webhook_secret',
      'supabase.service_role',
      'x.private_key',
      'y.access_token',
    ]) {
      expect(isCredentialShapedKey(key)).toBe(true)
    }
  })

  it('declares no credential-shaped key of its own', () => {
    for (const def of SETTING_DEFINITIONS) {
      expect(isCredentialShapedKey(def.key)).toBe(false)
    }
  })

  it('every default satisfies its own schema', () => {
    for (const def of SETTING_DEFINITIONS) {
      const result = parseSettingValue(def.key, def.defaultValue)
      expect(result.ok, `${def.key} default is invalid`).toBe(true)
    }
  })
})

describe('settings value validation', () => {
  it('accepts a valid confidence threshold', () => {
    expect(parseSettingValue('ai.confidence_threshold', 0.95).ok).toBe(true)
  })

  it('rejects a confidence outside 0..1', () => {
    expect(parseSettingValue('ai.confidence_threshold', 1.5).ok).toBe(false)
    expect(parseSettingValue('ai.confidence_threshold', -0.1).ok).toBe(false)
  })

  it('rejects a malformed recipients list', () => {
    expect(parseSettingValue('newsletter.recipients', ['not-an-email']).ok).toBe(false)
    expect(parseSettingValue('newsletter.recipients', 'a@b.com').ok).toBe(false)
  })

  it('accepts a valid recipients list', () => {
    expect(parseSettingValue('newsletter.recipients', ['legal@internal.test']).ok).toBe(true)
  })

  it('rejects malformed JSONB for the interval map', () => {
    expect(parseSettingValue('ingestion.priority_intervals', { '1': 60 }).ok).toBe(false)
    expect(parseSettingValue('ingestion.priority_intervals', 'not an object').ok).toBe(false)
    expect(
      parseSettingValue('ingestion.priority_intervals', {
        '1': 60, '2': 180, '3': 360, '4': 720, '5': 1440, '6': 99,
      }).ok,
      'strict() must reject an extra tier',
    ).toBe(false)
  })

  it('requires the retry backoff to be ascending', () => {
    expect(parseSettingValue('ingestion.retry_backoff_minutes', [5, 15, 45]).ok).toBe(true)
    expect(parseSettingValue('ingestion.retry_backoff_minutes', [45, 15, 5]).ok).toBe(false)
  })

  it('rejects an unknown timezone', () => {
    expect(parseSettingValue('app.timezone', 'Asia/Riyadh').ok).toBe(true)
    expect(parseSettingValue('app.timezone', 'Mars/Olympus').ok).toBe(false)
  })
})

describe('fail-closed resolution', () => {
  it('FAILS rather than defaulting when the confidence threshold is missing', () => {
    const r = resolveSetting('ai.confidence_threshold', null)
    expect(r.ok).toBe(false)
  })

  it('FAILS rather than defaulting when the threshold is malformed', () => {
    expect(resolveSetting('ai.confidence_threshold', 'nonsense').ok).toBe(false)
  })

  it('FAILS rather than defaulting when recipients are missing', () => {
    expect(resolveSetting('newsletter.recipients', null).ok).toBe(false)
  })

  it('falls back to the default for a non-critical setting', () => {
    const r = resolveSetting<number>('health.stale_after_minutes', null)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value).toBe(1440)
      expect(r.usedDefault).toBe(true)
    }
  })

  it('falls back for a malformed non-critical setting', () => {
    const r = resolveSetting<boolean>('newsletter.enabled', 'not a boolean')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toBe(false)
  })

  it('returns the stored value when it is valid', () => {
    const r = resolveSetting<number>('ai.confidence_threshold', 0.95)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value).toBe(0.95)
      expect(r.usedDefault).toBe(false)
    }
  })

  it('marks exactly the two security-sensitive settings fail-closed', () => {
    const failClosed = SETTING_DEFINITIONS.filter((d) => d.failClosed).map((d) => d.key)
    expect(failClosed.sort()).toEqual(['ai.confidence_threshold', 'newsletter.recipients'])
  })
})

/* -------------------------------------------------------------------------- */
/* Source form validation                                                      */
/* -------------------------------------------------------------------------- */

function sourceInput(overrides: Record<string, unknown> = {}) {
  return {
    country: 'SA',
    authority_ar: 'جهة اختبار',
    authority_en: 'Test Authority',
    source_type: 'government',
    base_url: 'https://example.gov.sa',
    feed_url: '',
    parser_type: 'unknown',
    parser_config: '',
    allowed_domains: 'example.gov.sa',
    priority: '3',
    poll_interval_minutes: '',
    notes: '',
    exclusion_group: '',
    requires_authority_check: false,
    ...overrides,
  }
}

describe('source form mirrors the database constraints', () => {
  it('accepts a well-formed source', () => {
    expect(sourceFormSchema.safeParse(sourceInput()).success).toBe(true)
  })

  it('requires the base_url host to be in allowed_domains', () => {
    const r = sourceFormSchema.safeParse(
      sourceInput({ base_url: 'https://other.gov.sa', allowed_domains: 'example.gov.sa' }),
    )
    expect(r.success).toBe(false)
  })

  it('requires the feed_url host to be in allowed_domains', () => {
    const r = sourceFormSchema.safeParse(
      sourceInput({
        parser_type: 'rss',
        feed_url: 'https://elsewhere.example/rss',
        allowed_domains: 'example.gov.sa',
      }),
    )
    expect(r.success).toBe(false)
  })

  it('requires a feed_url for rss and api parsers', () => {
    expect(sourceFormSchema.safeParse(sourceInput({ parser_type: 'rss' })).success).toBe(false)
    expect(sourceFormSchema.safeParse(sourceInput({ parser_type: 'api' })).success).toBe(false)
  })

  it('rejects a non-http scheme', () => {
    expect(
      sourceFormSchema.safeParse(sourceInput({ base_url: 'javascript:alert(1)' })).success,
    ).toBe(false)
    expect(
      sourceFormSchema.safeParse(sourceInput({ base_url: 'ftp://example.gov.sa' })).success,
    ).toBe(false)
  })

  it('rejects an empty domain list', () => {
    expect(sourceFormSchema.safeParse(sourceInput({ allowed_domains: '' })).success).toBe(false)
  })

  it('rejects domains carrying a scheme or path', () => {
    expect(
      sourceFormSchema.safeParse(sourceInput({ allowed_domains: 'https://example.gov.sa' }))
        .success,
    ).toBe(false)
    expect(
      sourceFormSchema.safeParse(sourceInput({ allowed_domains: 'example.gov.sa/news' })).success,
    ).toBe(false)
  })

  it('lowercases and de-duplicates domains', () => {
    const r = sourceFormSchema.safeParse(
      sourceInput({ allowed_domains: 'Example.GOV.sa\nexample.gov.sa' }),
    )
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.allowed_domains).toEqual(['example.gov.sa'])
  })

  it('rejects a priority outside 1..5', () => {
    expect(sourceFormSchema.safeParse(sourceInput({ priority: '0' })).success).toBe(false)
    expect(sourceFormSchema.safeParse(sourceInput({ priority: '9' })).success).toBe(false)
  })

  it('rejects a non-positive poll interval', () => {
    expect(
      sourceFormSchema.safeParse(sourceInput({ poll_interval_minutes: '0' })).success,
    ).toBe(false)
  })
})

describe('parser_config validation', () => {
  it('accepts an empty config as {}', () => {
    const r = sourceFormSchema.safeParse(sourceInput({ parser_config: '' }))
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.parser_config).toEqual({})
  })

  it('rejects malformed JSON', () => {
    expect(
      sourceFormSchema.safeParse(sourceInput({ parser_config: '{not json' })).success,
    ).toBe(false)
  })

  it('rejects a JSON array or scalar — it must be an object', () => {
    expect(sourceFormSchema.safeParse(sourceInput({ parser_config: '[1,2]' })).success).toBe(false)
    expect(sourceFormSchema.safeParse(sourceInput({ parser_config: '"x"' })).success).toBe(false)
    expect(sourceFormSchema.safeParse(sourceInput({ parser_config: 'null' })).success).toBe(false)
  })

  it('rejects workflow logic leaking into parser config', () => {
    // Mirrors SQL check S15: parser_config says WHERE to read, never what to do.
    for (const key of [
      'confidence_threshold',
      'retry_count',
      'publish_rule',
      'backoff',
      'cron',
      'enabled',
      'filter',
    ]) {
      const r = sourceFormSchema.safeParse(
        sourceInput({ parser_config: JSON.stringify({ [key]: 1, list: '.x' }) }),
      )
      expect(r.success, `${key} should be rejected`).toBe(false)
    }
  })

  it('accepts genuine selector keys', () => {
    const r = sourceFormSchema.safeParse(
      sourceInput({
        parser_config: JSON.stringify({ list: '.news', title: 'h3', link: 'a@href' }),
      }),
    )
    expect(r.success).toBe(true)
  })

  it('ships templates with EMPTY values — no guessed selectors', () => {
    for (const [type, template] of Object.entries(PARSER_CONFIG_TEMPLATES)) {
      const parsed = JSON.parse(template) as Record<string, unknown>
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === 'string') {
          expect(value, `${type}.${key} must not be pre-filled`).toBe('')
        }
      }
    }
  })
})

describe('verification blockers', () => {
  it('blocks verification while the parser is unknown', () => {
    expect(
      verificationBlockers({ parser_type: 'unknown', parser_config: {}, feed_url: null }),
    ).not.toHaveLength(0)
  })

  it('blocks an html or pdf source with no selectors', () => {
    expect(
      verificationBlockers({ parser_type: 'html', parser_config: {}, feed_url: null }),
    ).not.toHaveLength(0)
    expect(
      verificationBlockers({ parser_type: 'pdf', parser_config: {}, feed_url: null }),
    ).not.toHaveLength(0)
  })

  it('blocks an rss or api source with no feed url', () => {
    expect(
      verificationBlockers({ parser_type: 'rss', parser_config: {}, feed_url: null }),
    ).not.toHaveLength(0)
  })

  it('clears once the configuration is complete', () => {
    expect(
      verificationBlockers({
        parser_type: 'html',
        parser_config: { list: '.x' },
        feed_url: null,
      }),
    ).toHaveLength(0)
    expect(
      verificationBlockers({
        parser_type: 'rss',
        parser_config: {},
        feed_url: 'https://x.gov.sa/rss',
      }),
    ).toHaveLength(0)
  })
})

describe('activation gate', () => {
  it('permits only a verified, inactive source', () => {
    expect(canActivate({ active: false, config_status: 'verified' })).toBe(true)
  })

  it('refuses pending, blocked and subscription-gated sources', () => {
    expect(canActivate({ active: false, config_status: 'pending_verification' })).toBe(false)
    expect(canActivate({ active: false, config_status: 'blocked_by_access' })).toBe(false)
    expect(canActivate({ active: false, config_status: 'requires_subscription' })).toBe(false)
  })
})

describe('hostname extraction', () => {
  it('lowercases and strips port, path and query', () => {
    expect(hostnameOfUrl('https://Example.GOV.sa:443/a?b=1')).toBe('example.gov.sa')
  })

  it('returns null for a non-http scheme or malformed URL', () => {
    expect(hostnameOfUrl('javascript:alert(1)')).toBeNull()
    expect(hostnameOfUrl('data:text/html,x')).toBeNull()
    expect(hostnameOfUrl('not a url')).toBeNull()
  })

  it('resolves userinfo tricks to the real host', () => {
    expect(hostnameOfUrl('https://moj.gov.sa@evil.example/x')).toBe('evil.example')
  })
})
