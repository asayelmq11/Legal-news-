/**
 * Legal taxonomy. Every list here becomes a Postgres enum in M2 and a
 * constrained value in the AI prompt (M9) — the AI is told to choose from these
 * exact strings, and a value outside them is a rejection, never a coercion.
 */

export const SOURCE_TYPES = [
  'official_gazette',
  'government',
  'regulator',
  'approved_news',
  'gcc',
] as const
export type SourceType = (typeof SOURCE_TYPES)[number]

/**
 * Includes 'unknown', added to the Postgres enum in migration 0007. It means
 * "the parser has not been determined yet" and is set by the system, never
 * chosen by an admin — a source carrying it can never be activated.
 */
export const PARSER_TYPES = ['rss', 'html', 'api', 'pdf', 'unknown'] as const
export type ParserType = (typeof PARSER_TYPES)[number]

export const DOCUMENT_TYPES = [
  'law',
  'royal_decree',
  'ministerial_decision',
  'executive_regulation',
  'circular',
  'regulatory_framework',
  'official_notice',
  'court_precedent',
  'consultation_draft',
  'other',
] as const
export type DocumentType = (typeof DOCUMENT_TYPES)[number]

export const LEGAL_CATEGORIES = [
  'tax',
  'customs',
  'employment',
  'corporate',
  'financial',
  'capital_markets',
  'banking',
  'data_privacy',
  'cybersecurity',
  'competition',
  'intellectual_property',
  'litigation',
  'licensing',
  'real_estate',
  'energy',
  'healthcare',
  'trade',
  'general',
] as const
export type LegalCategory = (typeof LEGAL_CATEGORIES)[number]

export const LEGAL_STATUSES = [
  'enacted',
  'effective',
  'draft',
  'amended',
  'repealed',
  'pending',
] as const
export type LegalStatus = (typeof LEGAL_STATUSES)[number]

/**
 * Mirrors the health_status enum, extended in migration 0014 with the M10
 * classifications. 'disabled' and 'unverified' describe a source nobody is
 * checking; 'stale' one that is checked but has gone quiet for longer than its
 * configured silence window.
 */
export const HEALTH_STATUSES = [
  'never_run',
  'healthy',
  'degraded',
  'failing',
  'stale',
  'disabled',
  'unverified',
] as const
export type HealthStatus = (typeof HEALTH_STATUSES)[number]

export const RUN_STATUSES = ['success', 'partial', 'failed'] as const
export type RunStatus = (typeof RUN_STATUSES)[number]

export const TRIGGER_TYPES = ['scheduled', 'manual', 'retry'] as const
export type TriggerType = (typeof TRIGGER_TYPES)[number]

export const USER_ROLES = ['admin', 'viewer'] as const
export type UserRole = (typeof USER_ROLES)[number]

/* -------------------------------------------------------------------------- */
/* Arabic labels — the interface language of the platform.                     */
/* -------------------------------------------------------------------------- */

export const SOURCE_TYPE_LABELS_AR: Readonly<Record<SourceType, string>> = {
  official_gazette: 'الجريدة الرسمية',
  government: 'جهة حكومية',
  regulator: 'جهة تنظيمية',
  approved_news: 'مصدر إخباري معتمد',
  gcc: 'مجلس التعاون الخليجي',
}

export const DOCUMENT_TYPE_LABELS_AR: Readonly<Record<DocumentType, string>> = {
  law: 'نظام / قانون',
  royal_decree: 'مرسوم ملكي',
  ministerial_decision: 'قرار وزاري',
  executive_regulation: 'لائحة تنفيذية',
  circular: 'تعميم',
  regulatory_framework: 'إطار تنظيمي',
  official_notice: 'إشعار رسمي',
  court_precedent: 'سابقة قضائية',
  consultation_draft: 'مشروع للاستطلاع',
  other: 'أخرى',
}

export const LEGAL_CATEGORY_LABELS_AR: Readonly<Record<LegalCategory, string>> = {
  tax: 'الضرائب',
  customs: 'الجمارك',
  employment: 'العمل والموارد البشرية',
  corporate: 'الشركات',
  financial: 'التنظيم المالي',
  capital_markets: 'أسواق المال',
  banking: 'البنوك',
  data_privacy: 'حماية البيانات',
  cybersecurity: 'الأمن السيبراني',
  competition: 'المنافسة',
  intellectual_property: 'الملكية الفكرية',
  litigation: 'التقاضي',
  licensing: 'التراخيص',
  real_estate: 'العقار',
  energy: 'الطاقة',
  healthcare: 'الصحة',
  trade: 'التجارة',
  general: 'عام',
}

export const LEGAL_STATUS_LABELS_AR: Readonly<Record<LegalStatus, string>> = {
  enacted: 'صادر',
  effective: 'ساري',
  draft: 'مشروع',
  amended: 'مُعدَّل',
  repealed: 'مُلغى',
  pending: 'قيد النفاذ',
}

export const HEALTH_STATUS_LABELS_AR: Readonly<Record<HealthStatus, string>> = {
  never_run: 'لم يُشغَّل بعد',
  healthy: 'سليم',
  degraded: 'متدهور',
  failing: 'متعطل',
  stale: 'صامت',
  disabled: 'موقوف',
  unverified: 'غير متحقَّق منه',
}

export const USER_ROLE_LABELS_AR: Readonly<Record<UserRole, string>> = {
  admin: 'مسؤول',
  viewer: 'مطّلع',
}
