'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { requireAdmin } from '@/lib/auth/session'
import type { Enums, Json, TablesUpdate } from '@/types/database'
import { createClient } from '@/lib/supabase/server'
import type { ActionState } from '@/lib/actions/state'
import { hostnameOfUrl, sourceFormSchema } from '@/lib/admin/source-schema'
import { parseSettingValue, SETTINGS_BY_KEY } from '@/lib/settings/registry'

/**
 * Admin mutations.
 *
 * Every action starts with requireAdmin(), which redirects an inactive or
 * non-admin caller. Server Actions are reachable by direct POST, so a page
 * guard alone would not protect them.
 *
 * Beneath this, RLS is the boundary that actually holds: `sources`,
 * `users` and `app_settings` only accept writes when
 * public.current_user_role() = 'admin'. These checks exist to produce a clear
 * Arabic message rather than a silent zero-row update.
 */

const uuid = z.uuid({ error: 'معرّف غير صالح' })

/* -------------------------------------------------------------------------- */
/* Sources                                                                     */
/* -------------------------------------------------------------------------- */

function formToSourceInput(formData: FormData) {
  return {
    country: formData.get('country'),
    authority_ar: formData.get('authority_ar'),
    authority_en: formData.get('authority_en'),
    source_type: formData.get('source_type'),
    base_url: formData.get('base_url'),
    feed_url: formData.get('feed_url') ?? '',
    parser_type: formData.get('parser_type'),
    parser_config: formData.get('parser_config') ?? '',
    allowed_domains: formData.get('allowed_domains') ?? '',
    priority: formData.get('priority'),
    poll_interval_minutes: formData.get('poll_interval_minutes') ?? '',
    notes: formData.get('notes') ?? '',
    exclusion_group: formData.get('exclusion_group') ?? '',
    requires_authority_check: formData.get('requires_authority_check') === 'on',
  }
}

/**
 * Refuses to let one source claim a hostname that is another source's own
 * base_url host. Without this, an admin could point a source at a different
 * authority's domain and the archive would attribute that authority's
 * publications to the wrong body.
 */
async function crossSourceDomainConflict(
  domains: readonly string[],
  excludeId: string | null,
): Promise<string | null> {
  const supabase = await createClient()
  const { data } = await supabase.from('sources').select('id, base_url, authority_ar')

  for (const other of data ?? []) {
    if (excludeId && other.id === excludeId) continue
    const host = hostnameOfUrl(other.base_url)
    if (host && domains.includes(host)) {
      return `النطاق «${host}» هو النطاق الأساسي لمصدر آخر (${other.authority_ar}). لا يجوز أن يطالب مصدران بالنطاق نفسه.`
    }
  }
  return null
}

export async function saveSource(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireAdmin()

  const rawId = formData.get('id')
  const id = typeof rawId === 'string' && rawId !== '' ? rawId : null
  if (id && !uuid.safeParse(id).success) {
    return { ok: false, message: 'معرّف المصدر غير صالح' }
  }

  const parsed = sourceFormSchema.safeParse(formToSourceInput(formData))
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const key = issue.path[0]
      if (typeof key === 'string' && !fieldErrors[key]) fieldErrors[key] = issue.message
    }
    return {
      ok: false,
      message: 'تعذّر الحفظ. راجع الحقول المحدّدة.',
      fieldErrors,
    }
  }

  const v = parsed.data

  const conflict = await crossSourceDomainConflict(v.allowed_domains, id)
  if (conflict) return { ok: false, message: conflict }

  const supabase = await createClient()
  const payload = {
    country: v.country,
    authority_ar: v.authority_ar,
    authority_en: v.authority_en,
    source_type: v.source_type,
    base_url: v.base_url,
    feed_url: v.feed_url,
    parser_type: v.parser_type,
    parser_config: v.parser_config as Json,
    allowed_domains: v.allowed_domains,
    priority: v.priority,
    poll_interval_minutes: v.poll_interval_minutes,
    notes: v.notes ?? null,
    exclusion_group: v.exclusion_group,
    requires_authority_check: v.requires_authority_check,
    updated_at: new Date().toISOString(),
    updated_by: admin.id,
  }

  const { error } = id
    ? await supabase.from('sources').update(payload as TablesUpdate<'sources'>).eq('id', id)
    : await supabase.from('sources').insert({ ...payload, active: false })

  if (error) return { ok: false, message: translateDbError(error.message) }

  revalidatePath('/sources')
  return { ok: true, message: id ? 'تم تحديث المصدر.' : 'تم إنشاء المصدر (غير مفعّل).' }
}

/** Moves a source between pending / verified / blocked / subscription-required. */
export async function setSourceConfigStatus(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireAdmin()

  const id = String(formData.get('id') ?? '')
  const status = String(formData.get('config_status') ?? '')

  if (!uuid.safeParse(id).success) return { ok: false, message: 'معرّف المصدر غير صالح' }
  const allowed = ['pending_verification', 'verified', 'blocked_by_access', 'requires_subscription']
  if (!allowed.includes(status)) return { ok: false, message: 'حالة تحقق غير معروفة' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('sources')
    .update({
      config_status: status as Enums<'config_status'>,
      updated_at: new Date().toISOString(),
      updated_by: admin.id,
    })
    .eq('id', id)

  if (error) return { ok: false, message: translateDbError(error.message) }

  revalidatePath('/sources')
  return { ok: true, message: 'تم تحديث حالة التحقق.' }
}

/**
 * Activation and deactivation.
 *
 * The database refuses to activate anything that is not `verified`
 * (sources_only_verified_active) and refuses a second active member of an
 * exclusion group (partial unique index). Both are pre-checked here so the
 * admin sees why, but the constraint is what guarantees it.
 */
export async function setSourceActive(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireAdmin()

  const id = String(formData.get('id') ?? '')
  const active = formData.get('active') === 'true'
  if (!uuid.safeParse(id).success) return { ok: false, message: 'معرّف المصدر غير صالح' }

  const supabase = await createClient()
  const { data: source } = await supabase
    .from('sources')
    .select('id, config_status, exclusion_group, authority_ar, requires_authority_check')
    .eq('id', id)
    .maybeSingle()

  if (!source) return { ok: false, message: 'المصدر غير موجود' }

  if (active) {
    if (source.config_status !== 'verified') {
      return {
        ok: false,
        message:
          'لا يمكن تفعيل مصدر لم يُتحقَّق منه. أكمل التحقق من الوصول والمحلّل من بيئة التشغيل أولاً.',
      }
    }
    if (source.exclusion_group) {
      const { data: sibling } = await supabase
        .from('sources')
        .select('authority_ar')
        .eq('exclusion_group', source.exclusion_group)
        .eq('active', true)
        .neq('id', id)
        .maybeSingle()

      if (sibling) {
        return {
          ok: false,
          message: `مصدر آخر في المجموعة نفسها مفعّل بالفعل (${sibling.authority_ar}). قد يؤدي تفعيل الاثنين إلى ازدواج التحديثات نفسها، لذا عطّل الآخر أولاً.`,
        }
      }
    }
  }

  const { error } = await supabase
    .from('sources')
    .update({ active, updated_at: new Date().toISOString(), updated_by: admin.id })
    .eq('id', id)

  if (error) return { ok: false, message: translateDbError(error.message) }

  revalidatePath('/sources')
  revalidatePath('/')
  return { ok: true, message: active ? 'تم تفعيل المصدر.' : 'تم إيقاف المصدر.' }
}

/* -------------------------------------------------------------------------- */
/* Users                                                                       */
/* -------------------------------------------------------------------------- */

const profileSchema = z.object({
  id: z.uuid({ error: 'معرّف مستخدم Supabase غير صالح' }),
  email: z.email({ error: 'بريد إلكتروني غير صالح' }),
  full_name: z.string().trim().max(200).optional(),
  role: z.enum(['admin', 'viewer']),
})

/**
 * Creates a public.users profile for an EXISTING Supabase Auth user.
 *
 * The id must be copied from Authentication → Users in the Supabase dashboard.
 * The application cannot create auth accounts — that needs the service-role
 * key, which this app deliberately does not hold. It also handles no passwords
 * or credentials of any kind.
 */
export async function createUserProfile(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin()

  const parsed = profileSchema.safeParse({
    id: formData.get('id'),
    email: String(formData.get('email') ?? '').trim().toLowerCase(),
    full_name: formData.get('full_name') ?? undefined,
    role: formData.get('role'),
  })

  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'بيانات غير صالحة' }
  }

  const supabase = await createClient()
  const { error } = await supabase.from('users').insert({
    id: parsed.data.id,
    email: parsed.data.email,
    full_name: parsed.data.full_name ?? null,
    role: parsed.data.role,
    active: true,
  })

  if (error) {
    if (error.message.includes('users_id_fkey')) {
      return {
        ok: false,
        message:
          'لا يوجد مستخدم بهذا المعرّف في مصادقة Supabase. أنشئ الحساب أولاً من لوحة Supabase ثم انسخ المعرّف.',
      }
    }
    return { ok: false, message: translateDbError(error.message) }
  }

  revalidatePath('/users')
  return { ok: true, message: 'تم إنشاء ملف المستخدم.' }
}

/** Shared guard for the two mutations that can lock everyone out. */
async function assertNotLastActiveAdmin(targetId: string): Promise<string | null> {
  const supabase = await createClient()
  const { count } = await supabase
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'admin')
    .eq('active', true)
    .neq('id', targetId)

  if ((count ?? 0) === 0) {
    return 'هذا هو المسؤول الفعّال الأخير. عيّن مسؤولاً آخر قبل تغيير صلاحيته أو إيقافه، وإلا تعذّرت إدارة المنصة.'
  }
  return null
}

export async function setUserRole(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireAdmin()

  const id = String(formData.get('id') ?? '')
  const role = String(formData.get('role') ?? '')

  if (!uuid.safeParse(id).success) return { ok: false, message: 'معرّف المستخدم غير صالح' }
  if (role !== 'admin' && role !== 'viewer') return { ok: false, message: 'دور غير معروف' }

  if (id === admin.id && role !== 'admin') {
    return {
      ok: false,
      message: 'لا يمكنك خفض صلاحيتك بنفسك. اطلب من مسؤول آخر إجراء التغيير.',
    }
  }

  if (role === 'viewer') {
    const blocked = await assertNotLastActiveAdmin(id)
    if (blocked) return { ok: false, message: blocked }
  }

  const supabase = await createClient()
  const { error } = await supabase.from('users').update({ role }).eq('id', id)
  if (error) return { ok: false, message: translateDbError(error.message) }

  revalidatePath('/users')
  return { ok: true, message: 'تم تحديث الصلاحية.' }
}

export async function setUserActive(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireAdmin()

  const id = String(formData.get('id') ?? '')
  const active = formData.get('active') === 'true'
  if (!uuid.safeParse(id).success) return { ok: false, message: 'معرّف المستخدم غير صالح' }

  if (id === admin.id && !active) {
    return { ok: false, message: 'لا يمكنك إيقاف حسابك بنفسك.' }
  }

  if (!active) {
    const supabase = await createClient()
    const { data: target } = await supabase
      .from('users')
      .select('role')
      .eq('id', id)
      .maybeSingle()

    if (target?.role === 'admin') {
      const blocked = await assertNotLastActiveAdmin(id)
      if (blocked) return { ok: false, message: blocked }
    }
  }

  const supabase = await createClient()
  const { error } = await supabase.from('users').update({ active }).eq('id', id)
  if (error) return { ok: false, message: translateDbError(error.message) }

  revalidatePath('/users')
  return { ok: true, message: active ? 'تم تفعيل المستخدم.' : 'تم إيقاف المستخدم.' }
}

/* -------------------------------------------------------------------------- */
/* Settings                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Updates one known setting.
 *
 * The key must be in the registry. An unknown key is refused here, and the
 * database has no INSERT policy for application users, so a new key cannot be
 * introduced from the UI by any route.
 */
export async function updateSetting(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireAdmin()

  const key = String(formData.get('key') ?? '')
  const def = SETTINGS_BY_KEY.get(key)
  if (!def) return { ok: false, message: `مفتاح إعداد غير معروف: ${key}` }

  const raw = String(formData.get('value') ?? '')
  let candidate: unknown

  switch (def.control) {
    case 'boolean':
      candidate = raw === 'true' || raw === 'on'
      break
    case 'number': {
      const n = Number(raw)
      if (!Number.isFinite(n)) return { ok: false, message: 'القيمة يجب أن تكون رقماً' }
      candidate = n
      break
    }
    case 'string_list':
      candidate = raw
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
      break
    case 'json':
      try {
        candidate = JSON.parse(raw)
      } catch {
        return { ok: false, message: 'القيمة ليست JSON صالحاً' }
      }
      break
    case 'text':
    default:
      candidate = raw.trim()
  }

  const validated = parseSettingValue(key, candidate)
  if (!validated.ok) return { ok: false, message: validated.error }

  const supabase = await createClient()
  const { error, count } = await supabase
    .from('app_settings')
    .update(
      {
        value: validated.value as Json,
        updated_at: new Date().toISOString(),
        updated_by: admin.id,
      },
      { count: 'exact' },
    )
    .eq('key', key)

  if (error) return { ok: false, message: translateDbError(error.message) }
  if ((count ?? 0) === 0) {
    return { ok: false, message: 'لم يُحدَّث أي إعداد. تحقق من صلاحيتك.' }
  }

  revalidatePath('/settings')
  return { ok: true, message: 'تم حفظ الإعداد.' }
}

/* -------------------------------------------------------------------------- */

/** Turns the constraint names the database uses into something an admin can act on. */
function translateDbError(message: string): string {
  if (message.includes('sources_only_verified_active')) {
    return 'لا يمكن تفعيل مصدر لم يُتحقَّق منه.'
  }
  if (message.includes('sources_one_active_per_exclusion_group')) {
    return 'مصدر آخر في مجموعة الاستبعاد نفسها مفعّل بالفعل.'
  }
  if (message.includes('sources_base_url_domain_trusted')) {
    return 'مضيف الرابط الأساسي غير مدرج في النطاقات الموثوقة.'
  }
  if (message.includes('sources_verified_has_parser')) {
    return 'لا يمكن وسم المصدر كمُتحقَّق منه قبل تحديد نوع المحلّل.'
  }
  if (message.includes('sources_verified_html_pdf_config')) {
    return 'محلّل HTML أو PDF يتطلب مُحدِّدات قبل وسمه كمُتحقَّق منه.'
  }
  if (message.includes('sources_country_authority_key')) {
    return 'توجد جهة بهذا الاسم الإنجليزي في هذه الدولة بالفعل.'
  }
  if (message.includes('sources_base_url_key')) {
    return 'الرابط الأساسي مستخدم في مصدر آخر.'
  }
  if (message.includes('app_settings_no_secret_keys')) {
    return 'لا يجوز تخزين بيانات اعتماد في إعدادات التطبيق.'
  }
  if (message.includes('users_email_lowercase')) {
    return 'يجب إدخال البريد الإلكتروني بحروف صغيرة.'
  }
  if (message.includes('duplicate key')) {
    return 'القيمة مستخدمة بالفعل.'
  }
  return `تعذّر الحفظ: ${message}`
}
