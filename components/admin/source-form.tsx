'use client'

import { useActionState, useState } from 'react'

import { ActionMessage, Field, inputClass, SubmitButton } from '@/components/admin/form-parts'
import { IDLE, saveSource } from '@/lib/admin/actions'
import { PARSER_CONFIG_TEMPLATES } from '@/lib/admin/source-schema'
import { COUNTRIES, COUNTRY_CODES } from '@/lib/constants/countries'
import { PARSER_TYPES, SOURCE_TYPES, SOURCE_TYPE_LABELS_AR } from '@/lib/constants/taxonomy'
import type { SourceRow } from '@/lib/admin/queries'

const PARSER_LABELS: Record<string, string> = {
  rss: 'RSS / Atom',
  api: 'JSON API',
  html: 'صفحة HTML',
  pdf: 'فهرس PDF',
  unknown: 'غير محدد بعد',
}

export function SourceForm({ source }: { source?: SourceRow }) {
  const [state, formAction] = useActionState(saveSource, IDLE)
  const [parserType, setParserType] = useState(source?.parser_type ?? 'unknown')

  const err = (k: string) => state.fieldErrors?.[k]

  return (
    <form action={formAction} className="space-y-5">
      {source ? <input type="hidden" name="id" value={source.id} /> : null}

      <ActionMessage state={state} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="country" label="الدولة" error={err('country')}>
          <select id="country" name="country" defaultValue={source?.country ?? 'SA'} className={inputClass}>
            {COUNTRY_CODES.map((c) => (
              <option key={c} value={c}>
                {COUNTRIES[c].nameAr}
              </option>
            ))}
          </select>
        </Field>

        <Field id="source_type" label="تصنيف المصدر" error={err('source_type')}>
          <select
            id="source_type"
            name="source_type"
            defaultValue={source?.source_type ?? 'government'}
            className={inputClass}
          >
            {SOURCE_TYPES.map((t) => (
              <option key={t} value={t}>
                {SOURCE_TYPE_LABELS_AR[t]}
              </option>
            ))}
          </select>
        </Field>

        <Field id="authority_ar" label="اسم الجهة (عربي)" error={err('authority_ar')}>
          <input id="authority_ar" name="authority_ar" defaultValue={source?.authority_ar ?? ''} className={inputClass} required />
        </Field>

        <Field id="authority_en" label="اسم الجهة (إنجليزي)" error={err('authority_en')}>
          <input id="authority_en" name="authority_en" defaultValue={source?.authority_en ?? ''} className={inputClass} dir="ltr" required />
        </Field>
      </div>

      <Field
        id="base_url"
        label="الرابط الأساسي"
        hint="يجب أن يكون مضيف هذا الرابط ضمن النطاقات الموثوقة أدناه."
        error={err('base_url')}
      >
        <input id="base_url" name="base_url" defaultValue={source?.base_url ?? ''} className={inputClass} dir="ltr" required />
      </Field>

      <Field
        id="allowed_domains"
        label="النطاقات الموثوقة"
        hint="أسماء مضيفين فقط، واحد في كل سطر. تُطابَق تماماً: moj.gov.sa لا يشمل www.moj.gov.sa."
        error={err('allowed_domains')}
      >
        <textarea
          id="allowed_domains"
          name="allowed_domains"
          rows={3}
          defaultValue={(source?.allowed_domains ?? []).join('\n')}
          className={inputClass}
          dir="ltr"
          required
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="parser_type" label="نوع المحلّل" error={err('parser_type')}>
          <select
            id="parser_type"
            name="parser_type"
            value={parserType}
            onChange={(e) => setParserType(e.target.value as typeof parserType)}
            className={inputClass}
          >
            {PARSER_TYPES.map((p) => (
              <option key={p} value={p}>
                {PARSER_LABELS[p]}
              </option>
            ))}
          </select>
        </Field>

        <Field
          id="feed_url"
          label="رابط التغذية"
          hint="مطلوب لمحلّل RSS أو API."
          error={err('feed_url')}
        >
          <input id="feed_url" name="feed_url" defaultValue={source?.feed_url ?? ''} className={inputClass} dir="ltr" />
        </Field>
      </div>

      <Field
        id="parser_config"
        label="إعدادات المحلّل (JSON)"
        hint="يصف أين تُقرأ البيانات فقط. لا تضع هنا عتبات أو قواعد نشر أو إعادة محاولة — مكانها n8n."
        error={err('parser_config')}
      >
        <textarea
          id="parser_config"
          name="parser_config"
          rows={8}
          defaultValue={
            source && Object.keys(source.parser_config as object).length > 0
              ? JSON.stringify(source.parser_config, null, 2)
              : ''
          }
          placeholder={PARSER_CONFIG_TEMPLATES[parserType] ?? '{}'}
          className={`${inputClass} font-mono text-xs`}
          dir="ltr"
        />
        <p className="text-xs text-(--color-warn)">
          القالب المعروض فارغ عمداً. لا تُدخل مُحدِّدات مخمَّنة — المُحدِّد الخاطئ الذي يطابق شيئاً ما
          يملأ الأرشيف بمحتوى واثق وخاطئ منسوب إلى جهة رسمية.
        </p>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="priority" label="الأولوية (1 الأسرع — 5 الأبطأ)" error={err('priority')}>
          <input
            id="priority"
            name="priority"
            type="number"
            min={1}
            max={5}
            defaultValue={source?.priority ?? 3}
            className={inputClass}
            required
          />
        </Field>

        <Field
          id="poll_interval_minutes"
          label="فترة الاستطلاع (دقائق)"
          hint="اتركها فارغة لاستخدام فترة مستوى الأولوية."
          error={err('poll_interval_minutes')}
        >
          <input
            id="poll_interval_minutes"
            name="poll_interval_minutes"
            type="number"
            min={1}
            defaultValue={source?.poll_interval_minutes ?? ''}
            className={inputClass}
          />
        </Field>
      </div>

      <Field
        id="exclusion_group"
        label="مجموعة الاستبعاد"
        hint="مصادر قد تكون نسخاً متطابقة تتشارك الاسم نفسه؛ يُسمح بتفعيل عضو واحد فقط."
        error={err('exclusion_group')}
      >
        <input id="exclusion_group" name="exclusion_group" defaultValue={source?.exclusion_group ?? ''} className={inputClass} dir="ltr" />
      </Field>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="requires_authority_check"
          defaultChecked={source?.requires_authority_check ?? false}
          className="mt-1"
        />
        <span>
          <span className="font-medium text-(--color-ink)">يتطلب التحقق من هوية الجهة</span>
          <span className="block text-xs text-(--color-ink-subtle)">
            للنطاقات غير الحكومية (‎.com/.org‎) التي لا يمنح نطاقها أي ضمان.
          </span>
        </span>
      </label>

      <Field id="notes" label="ملاحظات" error={err('notes')}>
        <textarea id="notes" name="notes" rows={3} defaultValue={source?.notes ?? ''} className={inputClass} />
      </Field>

      <SubmitButton>{source ? 'حفظ التغييرات' : 'إنشاء المصدر'}</SubmitButton>
    </form>
  )
}
