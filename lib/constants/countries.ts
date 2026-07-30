/**
 * Country registry. These codes are the single source of truth for the
 * `country_code` Postgres enum created in M2 — the two must stay in step, and
 * the M2 migration comments point back here.
 */
export const COUNTRY_CODES = ['SA', 'AE', 'KW', 'QA', 'BH', 'OM', 'GCC'] as const

export type CountryCode = (typeof COUNTRY_CODES)[number]

interface CountryMeta {
  readonly code: CountryCode
  readonly nameAr: string
  readonly nameEn: string
}

export const COUNTRIES: Readonly<Record<CountryCode, CountryMeta>> = {
  SA: { code: 'SA', nameAr: 'المملكة العربية السعودية', nameEn: 'Saudi Arabia' },
  AE: { code: 'AE', nameAr: 'الإمارات العربية المتحدة', nameEn: 'United Arab Emirates' },
  KW: { code: 'KW', nameAr: 'دولة الكويت', nameEn: 'Kuwait' },
  QA: { code: 'QA', nameAr: 'دولة قطر', nameEn: 'Qatar' },
  BH: { code: 'BH', nameAr: 'مملكة البحرين', nameEn: 'Bahrain' },
  OM: { code: 'OM', nameAr: 'سلطنة عُمان', nameEn: 'Oman' },
  GCC: { code: 'GCC', nameAr: 'مجلس التعاون الخليجي', nameEn: 'GCC Secretariat' },
}

export function countryLabelAr(code: CountryCode): string {
  return COUNTRIES[code].nameAr
}

export function isCountryCode(value: string): value is CountryCode {
  return (COUNTRY_CODES as readonly string[]).includes(value)
}
