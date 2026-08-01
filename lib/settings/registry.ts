import { z } from 'zod'

/**
 * The application settings registry.
 *
 * ┌─ CLOSED ALLOW-LIST ────────────────────────────────────────────────────────┐
 * │ Every setting the platform recognises is declared here, with its value      │
 * │ schema, its default, its control type and whether it is security-critical.  │
 * │                                                                            │
 * │ A key absent from this registry cannot be written: the Server Action        │
 * │ rejects it before touching the database, and the database has no INSERT     │
 * │ policy for application users, so the key set is fixed by migration. Two     │
 * │ independent barriers, neither relying on the UI behaving.                   │
 * │                                                                            │
 * │ NO CREDENTIALS. Ever. API keys, tokens, passwords and webhook secrets live  │
 * │ in n8n Credentials or the deployment secret manager. A CHECK constraint on  │
 * │ app_settings additionally rejects credential-shaped key names.              │
 * └────────────────────────────────────────────────────────────────────────────┘
 */

/** How the admin UI renders a setting. */
export type SettingControl = 'number' | 'boolean' | 'text' | 'string_list' | 'json'

export interface SettingDefinition {
  readonly key: string
  readonly labelAr: string
  readonly descriptionAr: string
  readonly control: SettingControl
  readonly schema: z.ZodType
  readonly defaultValue: unknown
  /**
   * true  → a missing or malformed value must FAIL CLOSED. The consumer aborts
   *         and raises rather than substituting the default.
   * false → the default is a safe substitute.
   */
  readonly failClosed: boolean
  /** Shown beside the control when failClosed, so the consequence is visible. */
  readonly failClosedNoteAr?: string
}

/**
 * The half of a definition that may cross into a Client Component.
 *
 * `schema` is a Zod object — a class instance, and React refuses to serialise
 * one across the server/client boundary. Passing a whole SettingDefinition to
 * the settings form crashed the page at render time with "Only plain objects,
 * and a few built-ins, can be passed to Client Components". The schema belongs
 * on the server anyway: it is what parseSettingValue() validates against, and
 * shipping it to the browser would suggest the browser's copy mattered.
 */
export type SettingView = Omit<SettingDefinition, 'schema'>

export function toSettingView(def: SettingDefinition): SettingView {
  const { schema: _schema, ...view } = def
  return view
}

const emailList = z
  .array(z.email({ error: 'عنوان بريد إلكتروني غير صالح' }))
  .max(200, { error: 'الحد الأقصى 200 مستلم' })

const priorityIntervals = z
  .object({
    '1': z.number().int().positive(),
    '2': z.number().int().positive(),
    '3': z.number().int().positive(),
    '4': z.number().int().positive(),
    '5': z.number().int().positive(),
  })
  .strict()

export const SETTING_DEFINITIONS: readonly SettingDefinition[] = [
  {
    key: 'ai.confidence_threshold',
    labelAr: 'الحد الأدنى لثقة التصنيف',
    descriptionAr:
      'أقل قيمة ثقة يقبلها بوابة النشر في n8n. لا تُطبَّق في قاعدة البيانات — القرار كله في سير العمل.',
    control: 'number',
    schema: z.number().min(0).max(1),
    defaultValue: 0.9,
    failClosed: true,
    failClosedNoteAr:
      'إعداد حسّاس: عند غيابه أو تلفه ترفض بوابة النشر كل العناصر بدلاً من افتراض قيمة قد توسّع ما يُنشر.',
  },
  {
    key: 'ingestion.failure_alert_threshold',
    labelAr: 'عدد الإخفاقات قبل التنبيه',
    descriptionAr: 'عدد الإخفاقات المتتالية التي يصبح بعدها المصدر «متعطلاً» ويُرفع تنبيه.',
    control: 'number',
    schema: z.number().int().min(1).max(50),
    defaultValue: 5,
    failClosed: false,
  },
  {
    key: 'ingestion.priority_intervals',
    labelAr: 'فترات الاستطلاع حسب الأولوية',
    descriptionAr: 'بالدقائق لكل مستوى أولوية من 1 إلى 5. يتجاوزها إعداد المصدر الفردي إن وُجد.',
    control: 'json',
    schema: priorityIntervals,
    defaultValue: { '1': 60, '2': 180, '3': 360, '4': 720, '5': 1440 },
    failClosed: false,
  },
  {
    key: 'ingestion.retry_backoff_minutes',
    labelAr: 'جدول إعادة المحاولة',
    descriptionAr: 'تأخيرات تصاعدية بالدقائق. طول القائمة يحدّد أيضاً عدد المحاولات.',
    control: 'json',
    schema: z
      .array(z.number().int().positive())
      .min(1)
      .max(10)
      .refine((arr) => arr.every((v, i) => i === 0 || v > arr[i - 1]!), {
        error: 'يجب أن تكون التأخيرات تصاعدية',
      }),
    defaultValue: [5, 15, 45, 120, 360],
    failClosed: false,
  },
  {
    key: 'health.stale_after_minutes',
    labelAr: 'مدة اعتبار المصدر قديماً',
    descriptionAr: 'إذا لم ينجح المصدر خلال هذه المدة يُعرض كقديم في لوحة المتابعة.',
    control: 'number',
    schema: z.number().int().min(1).max(43_200),
    defaultValue: 1440,
    failClosed: false,
  },
  {
    key: 'health.empty_run_threshold',
    labelAr: 'عدد التشغيلات الفارغة قبل التدهور',
    descriptionAr: 'تشغيلات ناجحة بلا نتائج متتالية قبل وسم المصدر «متدهوراً» — تكشف مُحدِّداً معطلاً.',
    control: 'number',
    schema: z.number().int().min(1).max(50),
    defaultValue: 3,
    failClosed: false,
  },
  {
    key: 'newsletter.enabled',
    labelAr: 'تفعيل النشرة الأسبوعية',
    descriptionAr: 'المفتاح الرئيسي للإرسال. يُشحن معطّلاً حتى تُضبط قائمة المستلمين.',
    control: 'boolean',
    schema: z.boolean(),
    defaultValue: false,
    failClosed: false,
  },
  {
    key: 'newsletter.recipients',
    labelAr: 'مستلمو النشرة',
    descriptionAr: 'عناوين البريد الإلكتروني الداخلية، عنوان في كل سطر.',
    control: 'string_list',
    schema: emailList,
    defaultValue: [],
    failClosed: true,
    failClosedNoteAr:
      'إعداد حسّاس: عند غيابه أو فراغه تتوقف النشرة وتُسجَّل «أخفقت» بدلاً من الإرسال إلى قائمة غير مقصودة.',
  },
  {
    key: 'newsletter.schedule',
    labelAr: 'موعد إرسال النشرة',
    descriptionAr: 'اليوم 0 = الأحد … 6 = السبت، والساعة من 0 إلى 23 بتوقيت المنصة.',
    control: 'json',
    schema: z
      .object({ day: z.number().int().min(0).max(6), hour: z.number().int().min(0).max(23) })
      .strict(),
    defaultValue: { day: 0, hour: 7 },
    failClosed: false,
  },
  {
    key: 'app.timezone',
    labelAr: 'المنطقة الزمنية',
    descriptionAr: 'تُستخدم في تجميع التواريخ ونوافذ النشرة والعرض.',
    control: 'text',
    schema: z.string().refine(
      (tz) => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: tz })
          return true
        } catch {
          return false
        }
      },
      { error: 'منطقة زمنية غير معروفة (استخدم صيغة IANA مثل Asia/Riyadh)' },
    ),
    defaultValue: 'Asia/Riyadh',
    failClosed: false,
  },
] as const

export const SETTINGS_BY_KEY: ReadonlyMap<string, SettingDefinition> = new Map(
  SETTING_DEFINITIONS.map((d) => [d.key, d]),
)

export function isKnownSettingKey(key: string): boolean {
  return SETTINGS_BY_KEY.has(key)
}

export function getSettingDefinition(key: string): SettingDefinition | undefined {
  return SETTINGS_BY_KEY.get(key)
}

/**
 * Patterns that must never appear in a settings key. Defence in depth beside
 * the `app_settings_no_secret_keys` CHECK constraint: this catches an attempt
 * before it reaches the database, and catches a registry entry added carelessly
 * in review.
 */
const CREDENTIAL_SHAPED =
  /(secret|password|passwd|token|api_?key|credential|private_key|service_role)/i

export function isCredentialShapedKey(key: string): boolean {
  return CREDENTIAL_SHAPED.test(key)
}

export type SettingParse =
  | { ok: true; value: unknown }
  | { ok: false; error: string }

/**
 * Validates a value against its registry schema.
 *
 * Rejects unknown keys outright — an unrecognised key is never "probably fine",
 * it means the UI and the registry have diverged, or someone is probing.
 */
export function parseSettingValue(key: string, value: unknown): SettingParse {
  const def = SETTINGS_BY_KEY.get(key)
  if (!def) return { ok: false, error: `مفتاح إعداد غير معروف: ${key}` }
  if (isCredentialShapedKey(key)) {
    return { ok: false, error: 'لا يجوز تخزين بيانات اعتماد في إعدادات التطبيق' }
  }

  const parsed = def.schema.safeParse(value)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'قيمة غير صالحة' }
  }
  return { ok: true, value: parsed.data }
}

export type SettingResolution<T> =
  | { ok: true; value: T; usedDefault: boolean }
  | { ok: false; error: string }

/**
 * Resolves a stored value for a consumer.
 *
 * A non-critical setting falls back to its registry default when absent or
 * malformed. A `failClosed` setting does NOT — it returns an error, and the
 * caller is expected to abort. That asymmetry is the whole point: silently
 * defaulting `ai.confidence_threshold` could widen what gets published, and
 * silently defaulting `newsletter.recipients` could send legal content to the
 * wrong list.
 */
export function resolveSetting<T = unknown>(
  key: string,
  stored: unknown,
): SettingResolution<T> {
  const def = SETTINGS_BY_KEY.get(key)
  if (!def) return { ok: false, error: `مفتاح إعداد غير معروف: ${key}` }

  if (stored === undefined || stored === null) {
    if (def.failClosed) {
      return { ok: false, error: `الإعداد الحسّاس «${def.labelAr}» غير مضبوط` }
    }
    return { ok: true, value: def.defaultValue as T, usedDefault: true }
  }

  const parsed = def.schema.safeParse(stored)
  if (!parsed.success) {
    if (def.failClosed) {
      return { ok: false, error: `قيمة الإعداد الحسّاس «${def.labelAr}» غير صالحة` }
    }
    return { ok: true, value: def.defaultValue as T, usedDefault: true }
  }

  return { ok: true, value: parsed.data as T, usedDefault: false }
}
