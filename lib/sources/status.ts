import type { Enums } from '@/types/database'

export type ConfigStatus = Enums<'config_status'>

/**
 * The six statuses the admin panel displays, derived from two orthogonal stored
 * facts: `config_status` (how far verification has got) and `active` (whether
 * it is switched on).
 *
 * Deriving rather than storing a seventh column means the two can never
 * contradict each other — there is no way to record "active" on a row the
 * database considers unverified, because the display state is computed from the
 * same values the CHECK constraints police.
 */
export type SourceUiStatus =
  | 'active'
  | 'disabled'
  | 'verified'
  | 'pending_verification'
  | 'blocked_by_access'
  | 'requires_subscription'

export function deriveSourceStatus(source: {
  active: boolean
  config_status: ConfigStatus
}): SourceUiStatus {
  if (source.active) return 'active'
  // Verified but switched off is a deliberate operator choice, not a gap.
  if (source.config_status === 'verified') return 'disabled'
  return source.config_status
}

interface StatusMeta {
  readonly labelAr: string
  readonly descriptionAr: string
  /** Drives badge colour. */
  readonly tone: 'ok' | 'warn' | 'danger' | 'neutral'
  /** Whether the source is currently being crawled. */
  readonly isLive: boolean
  /** Whether a human still has to do something before it can run. */
  readonly needsAction: boolean
}

export const SOURCE_STATUS_META: Readonly<Record<SourceUiStatus, StatusMeta>> = {
  active: {
    labelAr: 'نشط',
    descriptionAr: 'يُرصد المصدر وفق جدولته.',
    tone: 'ok',
    isLive: true,
    needsAction: false,
  },
  disabled: {
    labelAr: 'موقوف',
    descriptionAr: 'تم التحقق من المصدر لكنه موقوف بقرار إداري.',
    tone: 'neutral',
    isLive: false,
    needsAction: false,
  },
  verified: {
    labelAr: 'تم التحقق',
    descriptionAr: 'جاهز للتفعيل بعد نجاح الجلب من بيئة التشغيل.',
    tone: 'ok',
    isLive: false,
    needsAction: false,
  },
  pending_verification: {
    labelAr: 'بانتظار التحقق',
    descriptionAr: 'لم يُحدَّد بعد أسلوب القراءة. لا يمكن تفعيله.',
    tone: 'warn',
    isLive: false,
    needsAction: true,
  },
  blocked_by_access: {
    labelAr: 'محجوب',
    descriptionAr: 'يتعذر الوصول نظامياً — جدار حماية أو قيود robots. يحتاج قراراً بنيوياً.',
    tone: 'danger',
    isLive: false,
    needsAction: true,
  },
  requires_subscription: {
    labelAr: 'يتطلب اشتراكاً',
    descriptionAr: 'الوصول المشروع يستلزم اشتراكاً أو اتفاقاً موثقاً.',
    tone: 'danger',
    isLive: false,
    needsAction: true,
  },
}

/**
 * Only a verified source may be activated. Mirrors the
 * sources_only_verified_active CHECK constraint — the database is the
 * enforcement point; this exists so the UI can disable the control and explain
 * why instead of surfacing a constraint violation.
 */
export function canActivate(source: {
  active: boolean
  config_status: ConfigStatus
}): boolean {
  return !source.active && source.config_status === 'verified'
}
